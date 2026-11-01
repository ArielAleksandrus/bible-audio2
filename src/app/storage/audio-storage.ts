import { dbPromise } from './my-db';
import { isNativeApp, nativePlatform, nativeSafeUrl } from '../utils/platform.util';
import { bypassServiceWorker } from '../utils/sw-bypass.util';
import { capacitorPlugins } from '../utils/capacitor-plugins';

/**
 * Where downloaded chapter MP3s live.
 *
 * - Web/PWA: IndexedDB (`audio-db` → `files`), as Blobs — unchanged from
 *   before the native apps existed.
 * - Native (Capacitor): plain files under the app's private data directory
 *   (`audios/*.mp3` in Directory.Data on Android, Library/NoCloud on iOS).
 *   The OS media player (ExoPlayer /
 *   AVPlayer) has to be able to open them by path, which it can't do with a
 *   Blob inside the WebView's IndexedDB — and ~1.3 GB of Blobs in IndexedDB
 *   is also exactly the kind of storage mobile OSes are quickest to evict.
 *
 * Everything that used to talk to the `files` store directly goes through
 * here instead, so the rest of the app doesn't care which one it's on.
 */
export interface StoredAudio {
  id: string;
  size: number;
  downloadedAt: number;
}

export interface AudioStorage {
  has(id: string): Promise<boolean>;
  /** Download `url` and store it under `id`. Resolves once it's fully on disk. */
  download(id: string, url: string, signal?: AbortSignal): Promise<void>;
  /**
   * A URL the current player can open: `blob:` on web (caller must revoke),
   * `file://` on native. null when not stored.
   */
  playableUrl(id: string): Promise<string | null>;
  list(): Promise<StoredAudio[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** An AbortSignal that trips as soon as either input does (AbortSignal.any needs iOS 17.4+). */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  a.addEventListener('abort', () => controller.abort(a.reason), { once: true });
  b.addEventListener('abort', () => controller.abort(b.reason), { once: true });
  return controller.signal;
}

// ---------------------------------------------------------------------------
// Web (IndexedDB)
// ---------------------------------------------------------------------------

export class IndexedDbAudioStorage implements AudioStorage {
  async has(id: string): Promise<boolean> {
    const db = await dbPromise;
    return !!(await db.getKey('files', id));
  }

  async download(id: string, url: string, signal?: AbortSignal): Promise<void> {
    const timeoutSignal = AbortSignal.timeout(120_000);
    // Query-param service-worker bypass only (see sw-bypass.util.ts). A
    // custom `ngsw-bypass` header would trigger a CORS preflight against the
    // R2 CDN and can fail the download entirely.
    const response = await fetch(bypassServiceWorker(url), {
      mode: 'cors',
      cache: 'no-store',
      signal: signal ? combineSignals(timeoutSignal, signal) : timeoutSignal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

    const blob = new Blob([await response.blob()], { type: 'audio/mpeg' });
    const db = await dbPromise;
    await db.put('files', { id, blob, url, downloadedAt: Date.now() });
  }

  async playableUrl(id: string): Promise<string | null> {
    const db = await dbPromise;
    const stored = await db.get('files', id);
    return stored?.blob ? URL.createObjectURL(stored.blob) : null;
  }

  async list(): Promise<StoredAudio[]> {
    const db = await dbPromise;
    const all = await db.getAll('files');
    return all.map(f => ({ id: f.id, size: f.blob?.size ?? 0, downloadedAt: f.downloadedAt }));
  }

  async remove(id: string): Promise<void> {
    const db = await dbPromise;
    await db.delete('files', id);
  }

  async clear(): Promise<void> {
    const db = await dbPromise;
    await db.clear('files');
  }
}

// ---------------------------------------------------------------------------
// Native (Filesystem + FileTransfer)
// ---------------------------------------------------------------------------

const AUDIO_DIR = 'audios';

/**
 * Track ids look like `ara-gn-1`, but some translations use non-ASCII book
 * abbreviations (e.g. Chinese). Keep filenames plain ASCII so the resulting
 * `file://` URI never needs percent-encoding — iOS's `URL(string:)` (used by
 * the playlist plugin) returns nil for an unencoded non-ASCII path.
 */
export function idToFileName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9-]/g, c => `_u${c.codePointAt(0)!.toString(16)}_`);
  return `${safe}.mp3`;
}

export function fileNameToId(name: string): string {
  return name
    .replace(/\.mp3$/, '')
    .replace(/_u([0-9a-f]+)_/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

export class FilesystemAudioStorage implements AudioStorage {
  /** id → info, loaded once from a directory listing (1 bridge call instead of ~1200 stats). */
  private index: Promise<Map<string, StoredAudio>> | null = null;

  /**
   * `dir` is where the chapters live. On iOS, Directory.Data is Documents/,
   * which is backed up to iCloud: ~1.3 GB of re-downloadable MP3s there
   * would eat the user's iCloud quota and breaks App Store Review
   * Guideline 2.23 (iOS Data Storage Guidelines), a common rejection
   * reason. Library/NoCloud is private, persistent and never backed up.
   * Android keeps Directory.Data (the app's files dir, unchanged).
   */
  private async fs() {
    const { Filesystem, Directory } = await capacitorPlugins.filesystem();
    const dir = nativePlatform() === 'ios' ? Directory.LibraryNoCloud : Directory.Data;
    return { Filesystem, dir };
  }

  private getIndex(): Promise<Map<string, StoredAudio>> {
    if (!this.index) {
      this.index = (async () => {
        const { Filesystem, dir } = await this.fs();
        const map = new Map<string, StoredAudio>();
        try {
          const { files } = await Filesystem.readdir({ path: AUDIO_DIR, directory: dir });
          for (const f of files) {
            // Left behind by a download the app was killed in the middle of.
            // Safe to delete here: this listing runs before the first
            // download can start (every download checks has() first).
            if (f.type === 'file' && f.name.endsWith('.part')) {
              void Filesystem.deleteFile({ path: `${AUDIO_DIR}/${f.name}`, directory: dir }).catch(() => {});
              continue;
            }
            if (f.type !== 'file' || !f.name.endsWith('.mp3')) continue;
            const id = fileNameToId(f.name);
            map.set(id, { id, size: f.size, downloadedAt: f.mtime });
          }
        } catch {
          // Directory doesn't exist yet — nothing downloaded.
        }
        return map;
      })();
    }
    return this.index;
  }

  async has(id: string): Promise<boolean> {
    return (await this.getIndex()).has(id);
  }

  async download(id: string, url: string): Promise<void> {
    const { Filesystem, dir } = await this.fs();
    const { FileTransfer } = await capacitorPlugins.fileTransfer();

    const finalPath = `${AUDIO_DIR}/${idToFileName(id)}`;
    const partPath = `${finalPath}.part`;

    await Filesystem.mkdir({ path: AUDIO_DIR, directory: dir, recursive: true }).catch(() => {});
    const { uri: partUri } = await Filesystem.getUri({ path: partPath, directory: dir });

    // Native HTTP: no CORS, no WebView memory spent on the body, and it keeps
    // going while the WebView is throttled in the background. Written to a
    // `.part` file first so an interrupted download is never mistaken for a
    // finished chapter by the directory index above.
    try {
      await FileTransfer.downloadFile({ url: nativeSafeUrl(url), path: partUri, progress: false });
      await Filesystem.rename({
        from: partPath,
        to: finalPath,
        directory: dir,
        toDirectory: dir,
      });
    } catch (err) {
      // A connection drop / HTTP error / full disk mid-transfer leaves a
      // truncated `.part` behind. It's never indexed, but it does keep
      // eating the device's storage until the same chapter is retried.
      await Filesystem.deleteFile({ path: partPath, directory: dir }).catch(() => {});
      throw err;
    }

    const stat = await Filesystem.stat({ path: finalPath, directory: dir });
    (await this.getIndex()).set(id, { id, size: stat.size, downloadedAt: Date.now() });
  }

  async playableUrl(id: string): Promise<string | null> {
    if (!(await this.has(id))) return null;
    const { Filesystem, dir } = await this.fs();
    const { uri } = await Filesystem.getUri({ path: `${AUDIO_DIR}/${idToFileName(id)}`, directory: dir });
    return uri;
  }

  async list(): Promise<StoredAudio[]> {
    return [...(await this.getIndex()).values()];
  }

  async remove(id: string): Promise<void> {
    const { Filesystem, dir } = await this.fs();
    await Filesystem.deleteFile({ path: `${AUDIO_DIR}/${idToFileName(id)}`, directory: dir }).catch(() => {});
    (await this.getIndex()).delete(id);
  }

  async clear(): Promise<void> {
    const { Filesystem, dir } = await this.fs();
    await Filesystem.rmdir({ path: AUDIO_DIR, directory: dir, recursive: true }).catch(() => {});
    (await this.getIndex()).clear();
  }
}

export const audioStorage: AudioStorage = isNativeApp()
  ? new FilesystemAudioStorage()
  : new IndexedDbAudioStorage();
