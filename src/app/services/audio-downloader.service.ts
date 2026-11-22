import { Injectable } from '@angular/core';
import { AvailableSpace } from '../storage/my-db';
import { audioExt, audioStorage, idToFileName } from '../storage/audio-storage';
import { clearStoredRevs, forgetStoredRev, setStoredRev, storedRev } from '../storage/audio-revs';
import { Track } from '../models/track';
import { runWithConcurrency } from '../utils/concurrency.util';
import { onWifi } from '../utils/network.util';
import { isNativeApp, nativePlatform } from '../utils/platform.util';
import { BulkDownload, type BulkDownloadSnapshot, type BulkDownloadStatus } from '../native/bulk-download';
import { Subject } from 'rxjs';

export interface DownloadProgress {
  downloaded: number;
  total: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  currentTrack?: Track;
  // Distinguishes a full-Bible download (downloadEntireBible) from any
  // other batch (e.g. the chapters/book the user just tapped in the
  // picker) — both report through this same subject, so UI that only cares
  // about "the whole Bible is done" (the hero header's success banner)
  // needs this to avoid firing after a single chapter.
  context?: 'full-bible' | 'selection';
  /** Chapters that still failed after retrying (status 'error'). */
  failed?: number;
}

/** Texts for the Android download notification (see BulkDownloadPlugin). */
export interface BulkDownloadStrings {
  title: string;
  progress: string;
  complete: string;
  incomplete: string;
  cancel: string;
}

@Injectable({ providedIn: 'root' })
export class AudioDownloaderService {
  // How many chapters to fetch in parallel during a bulk download.
  private static readonly DOWNLOAD_CONCURRENCY = 3;
  // If a bulk download makes no progress at all for this long — e.g. the
  // screen was locked and the tab got frozen/throttled — treat it as
  // stopped rather than leaving the progress bar stuck on "running" with no
  // way for the user to retry.
  private static readonly STALL_TIMEOUT_MS = 60_000;
  private static readonly STALL_CHECK_INTERVAL_MS = 5_000;

  private tracks: Track[] = [];
  /** Dedup concurrent downloads of the same chapter (plan preload + playlist preload). */
  private inFlight = new Map<string, Promise<void>>();
  /** Chapters whose newer revision is being fetched (refreshIfStale), one at a time. */
  private refreshing = new Set<string>();
  private refreshQueue: Promise<void> = Promise.resolve();

  private downloadProgressSubject = new Subject<DownloadProgress>();

  // Public observable for components to subscribe
  downloadProgress$ = this.downloadProgressSubject.asObservable();

  /** Emits each track right after it lands on the device (NativeAudioEngine swaps its queue entry to the local file). */
  readonly trackDownloaded$ = new Subject<Track>();

  /** A download was refused because the device is almost full (ensureFreeDiskSpace). */
  readonly lowSpace$ = new Subject<void>();

  // --- Android foreground-service download (full Bible) ---
  /** Tracks of the running service job, so its per-chapter events can feed trackDownloaded$. */
  private bulkTracks = new Map<string, Track>();
  /** Last service status we acted on; terminal states only matter right after 'running'. */
  private bulkStatus: BulkDownloadStatus = 'idle';
  private bulkFinished: (() => void) | null = null;

  constructor() {
    if (nativePlatform() === 'android') this.attachBulkDownload();
  }

  getTracks(): Track[] {
    return this.tracks;
  }

  /** Download a single track */
  async download(track: Track, signal?: AbortSignal): Promise<void> {
    const key = track.id || track.fileName;
    const ongoing = this.inFlight.get(key);
    if (ongoing) return ongoing;

    const promise = this.downloadExclusive(track, signal).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async downloadExclusive(track: Track, signal?: AbortSignal): Promise<void> {
    if (await this.isDownloaded(track)) {
      track.status = 'done';
      return;
    }

    await this.ensureFreeDiskSpace();

    track.status = 'downloading';
    try {
      await audioStorage.download(track.id || track.fileName, track.url, signal);
      setStoredRev(track.id || track.fileName, track.rev);
    } catch (err) {
      track.status = 'error';
      console.error(`Falha: ${track.title}`, err);
      throw err instanceof Error ? err : new Error(`Falha: ${track.title}`);
    }
    track.status = 'done';
    this.trackDownloaded$.next(track);
  }

  async downloadTracks(tracks: Track[], context: 'full-bible' | 'selection' = 'selection'): Promise<void> {
    this.tracks = tracks;

    const total = tracks.length;

    // First, count how many are already downloaded
    const alreadyDone = await this.areDownloaded(tracks);
    let downloadedCount = total - alreadyDone.pendingCount;

    if (alreadyDone.pendingCount === 0) {
      this.reportProgress(downloadedCount, total, undefined, 'completed', context);
      return;
    }

    this.reportProgress(downloadedCount, total, undefined, 'running', context);

    // Bail out of the whole batch if nothing has completed for a while —
    // most likely the screen got locked and the tab was frozen/throttled.
    // Without this, the progress bar would stay stuck on "running" forever
    // with no way for the user to retry (the download button only reappears
    // once status leaves 'running').
    const stallController = new AbortController();
    let lastProgressAt = Date.now();
    const checkStalled = () => {
      if (Date.now() - lastProgressAt > AudioDownloaderService.STALL_TIMEOUT_MS) {
        stallController.abort(new Error('Bulk download stalled (screen locked/backgrounded too long)'));
      }
    };
    // Native downloads run in the OS HTTP stack and keep going while the
    // WebView is backgrounded, so a long gap with no JS progress there just
    // means the screen was off — not a frozen tab. Only the web needs this.
    const watchdog = isNativeApp() ? undefined : setInterval(checkStalled, AudioDownloaderService.STALL_CHECK_INTERVAL_MS);
    // Re-check the instant the tab is foregrounded again instead of waiting
    // for the next watchdog tick, so the button reappears right on unlock.
    const onVisible = () => {
      if (!isNativeApp() && document.visibilityState === 'visible') checkStalled();
    };
    document.addEventListener('visibilitychange', onVisible);

    try {
      await runWithConcurrency(tracks, AudioDownloaderService.DOWNLOAD_CONCURRENCY, async (track) => {
        if (stallController.signal.aborted) return;
        if (await this.isDownloaded(track)) return;

        try {
          this.reportProgress(downloadedCount, total, track, 'running', context); // show current track
          await this.download(track, stallController.signal);
          downloadedCount++;
          lastProgressAt = Date.now();
          this.reportProgress(downloadedCount, total, undefined, 'running', context); // update downloaded count
        } catch (err) {
          if (stallController.signal.aborted) return; // bailing out entirely, not a single-chapter failure
          console.error('Failed to download track', track, err);
          // Decide: continue or stop? Here we continue
          track.status = 'error';
          lastProgressAt = Date.now(); // still making progress overall, just this file failed
          this.reportProgress(downloadedCount, total, track, 'running', context);
        }

        // Yield without rAF: requestAnimationFrame never fires while the
        // screen is off, which would stall the rest of the playlist download.
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    } finally {
      if (watchdog) clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
    }

    if (stallController.signal.aborted) {
      this.reportProgress(downloadedCount, total, undefined, 'error', context, total - downloadedCount);
      return;
    }

    // One more pass over the chapters that failed (a dropped connection
    // usually comes back), one at a time.
    const failed = tracks.filter(t => t.status === 'error');
    for (const track of failed) {
      try {
        this.reportProgress(downloadedCount, total, track, 'running', context);
        await this.download(track);
        downloadedCount++;
      } catch (err) {
        console.error('Retry failed for track', track, err);
        track.status = 'error';
      }
    }

    // Only claim success when every chapter is really on the device.
    const stillFailed = total - downloadedCount;
    this.reportProgress(
      downloadedCount, total, undefined, stillFailed === 0 ? 'completed' : 'error', context, stillFailed);
  }

  /**
   * Full-Bible download. On Android it runs in a foreground service with a
   * progress notification, so it survives the user leaving the app; the
   * WebView-driven queue in downloadTracks() stops when Android pauses the
   * WebView. Elsewhere it falls back to downloadTracks(). Resolves when the
   * batch is over (completed, failed or cancelled).
   */
  async downloadInBackground(tracks: Track[], strings: BulkDownloadStrings): Promise<void> {
    if (nativePlatform() !== 'android') return this.downloadTracks(tracks, 'full-bible');

    if (tracks.length === 0) {
      this.reportProgress(0, 0, undefined, 'completed', 'full-bible');
      return;
    }

    await this.askNotificationPermission();

    this.bulkTracks = new Map(tracks.map(t => [t.id, t]));
    const finished = new Promise<void>(resolve => (this.bulkFinished = resolve));
    // Set before start() so progress events that beat its reply count.
    this.bulkStatus = 'running';
    try {
      const snapshot = await BulkDownload.start({
        items: tracks.map(t => ({ id: t.id, url: t.url, fileName: idToFileName(t.id, audioExt(t.url)) })),
        strings,
      });
      this.onBulkProgress(snapshot);
    } catch (err) {
      console.error('Bulk download service failed to start; downloading in the app instead', err);
      this.bulkStatus = 'idle';
      this.bulkFinished = null;
      return this.downloadTracks(tracks, 'full-bible');
    }
    return finished;
  }

  cancelBackgroundDownload(): void {
    if (nativePlatform() === 'android') void BulkDownload.cancel();
  }

  private attachBulkDownload(): void {
    void BulkDownload.addListener('progress', s => this.onBulkProgress(s));
    void BulkDownload.addListener('itemDone', ({ id, size }) => {
      const track = this.bulkTracks.get(id);
      // Without the track (the WebView was recreated mid-batch) the file's
      // extension is unknown here: re-read the folder instead.
      if (track) {
        void audioStorage.markStored(id, size, audioExt(track.url));
        setStoredRev(id, track.rev);
      } else {
        audioStorage.invalidate();
      }
      if (track) {
        track.status = 'done';
        this.trackDownloaded$.next(track);
      }
    });
    // The WebView may have been recreated while the service kept running,
    // and events are not replayed: pick the job up again on start/resume.
    const sync = () => BulkDownload.getStatus().then(s => this.onBulkProgress(s)).catch(() => {});
    void sync();
    void import('@capacitor/app').then(({ App }) => App.addListener('resume', sync));
  }

  private onBulkProgress(s: BulkDownloadSnapshot): void {
    if (s.status === 'running') {
      this.bulkStatus = 'running';
      this.reportProgress(s.downloaded, s.total, undefined, 'running', 'full-bible');
      return;
    }
    // A terminal status only means something right after a run we saw;
    // otherwise it's the leftover of an older job.
    if (this.bulkStatus !== 'running' || s.status === 'idle') return;
    this.bulkStatus = s.status;

    // Files were written behind the storage index's back.
    audioStorage.invalidate();
    if (s.status === 'completed') {
      this.reportProgress(s.downloaded, s.total, undefined, 'completed', 'full-bible');
    } else if (s.status === 'error') {
      this.reportProgress(s.downloaded, s.total, undefined, 'error', 'full-bible', s.failed);
    } else {
      this.reportProgress(s.downloaded, s.total, undefined, 'idle', 'full-bible');
    }
    this.bulkTracks.clear();
    this.bulkFinished?.();
    this.bulkFinished = null;
  }

  /** Android 13+ hides the progress notification without it; the download runs either way. */
  private async askNotificationPermission(): Promise<void> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
        await LocalNotifications.requestPermissions();
      }
    } catch {
      // Not fatal.
    }
  }

  /**
   * Refuses to start a download when the device is almost full, instead of
   * making room: deleting chapters on its own could take away a voice the
   * user downloaded to listen offline. Web only — in the native app the
   * WebView's quota estimate doesn't cover the audio files at all, so a
   * full disk there just fails the download.
   */
  async ensureFreeDiskSpace(): Promise<void> {
    if (isNativeApp()) return;
    const space = new AvailableSpace();
    if (await space.isSafe()) return;
    this.lowSpace$.next();
    throw new Error(`Only ${await space.inMB()} MB of storage left`);
  }

  async removeById(trackId: string): Promise<void> {
    await audioStorage.remove(trackId);
    forgetStoredRev(trackId);
    console.log(`Removed file ${trackId} from cache`);
  }

  /** Check if already downloaded (`fileName` is the legacy IndexedDB key). */
  async isDownloaded(track: Track): Promise<boolean> {
    return (await audioStorage.has(track.id)) || (!!track.fileName && await audioStorage.has(track.fileName));
  }

  /**
   * A URL the player can open for this track if it's on the device, else
   * null. When the stored file is an older revision than the catalog's, it
   * is still what plays now, and the new one is fetched in the background to
   * replace it (refreshIfStale), on any connection: the next time, the
   * chapter plays the new file. Chapters already on the device are also
   * fetched ahead of play when the connection is Wi-Fi (prefetchStaleOnWifi).
   */
  async localUrl(track: Track): Promise<string | null> {
    for (const key of [track.id, track.fileName]) {
      if (!key) continue;
      const url = await audioStorage.playableUrl(key);
      if (url) {
        this.refreshIfStale(track, key);
        return url;
      }
    }
    return null;
  }

  /** Whether the audio stored under `key` is older than the revision the catalog gives this track. */
  isStale(track: Track, key = track.id): boolean {
    return (track.rev ?? 1) > storedRev(key);
  }

  /**
   * Fetch newer revisions of chapters the device already has, one at a time,
   * and only while `onWifi` is true. Nothing is queued on cellular or when
   * the browser cannot say what the connection is. No progress is reported:
   * the file in use now is left alone until the new one is complete.
   */
  prefetchStaleOnWifi(tracks: readonly Track[]): void {
    void this.enqueueWifiRefresh(tracks);
  }

  private async enqueueWifiRefresh(tracks: readonly Track[]): Promise<void> {
    if (!(await onWifi())) return;
    for (const track of tracks) this.refreshIfStale(track, track.id, true);
  }

  /**
   * Fetch the catalog's revision of a chapter stored at an older one, over
   * the old file, without telling anyone: the old file stays usable until
   * the new one is complete (and stays, if the download fails — it is tried
   * again the next time the chapter is looked up). One at a time, so a
   * queue of a whole book does not open dozens of downloads at once.
   * `wifiOnly` checks the connection again at the head of the queue, so a
   * download that was waiting does not start after the device left Wi-Fi.
   */
  private refreshIfStale(track: Track, key: string, wifiOnly = false): void {
    if (!track.id || !this.isStale(track, key)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (this.refreshing.has(track.id) || this.inFlight.has(track.id)) return;
    this.refreshing.add(track.id);
    this.refreshQueue = this.refreshQueue.then(async () => {
      try {
        if (!this.isStale(track, key)) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (wifiOnly && !(await onWifi())) return;
        await audioStorage.download(track.id, track.url);
        setStoredRev(track.id, track.rev);
        if (key !== track.id) {
          // It was under an old key: the new file is under the id now.
          await audioStorage.remove(key);
          forgetStoredRev(key);
        }
      } catch (err) {
        console.warn(`Could not fetch the new revision of ${track.title}; keeping the one on the device`, err);
      } finally {
        this.refreshing.delete(track.id);
      }
    });
  }

  async areDownloaded(tracks: Track[]): Promise<{total: number, pendingCount: number, pending: string[]}> {
    const res = { total: 0, pendingCount: 0, pending: [] as string[] };
    for (const track of tracks) {
      if (await this.isDownloaded(track)) {
        res.total += 1;
      } else {
        res.pendingCount += 1;
        res.pending.push(track.id);
      }
    }
    return res;
  }

  /** Total downloaded chapters */
  async getDownloadedCount(): Promise<number> {
    return (await audioStorage.list()).length;
  }

  /** Bytes used by downloaded chapters. */
  async getDownloadedBytes(): Promise<number> {
    return (await audioStorage.list()).reduce((sum, f) => sum + f.size, 0);
  }

  async clearAll(): Promise<void> {
    await audioStorage.clear();
    clearStoredRevs();
  }

  private reportProgress(
    downloaded: number,
    total: number,
    currentTrack?: Track,
    status: DownloadProgress['status'] = 'running',
    context?: 'full-bible' | 'selection',
    failed?: number
  ) {
    this.downloadProgressSubject.next({
      downloaded,
      total,
      currentTrack,
      status,
      context,
      failed
    });
  }
}
