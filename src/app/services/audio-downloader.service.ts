import { Injectable } from '@angular/core';
import { AvailableSpace } from '../storage/my-db';
import { audioStorage, idToFileName } from '../storage/audio-storage';
import { Track } from '../models/track';
import { runWithConcurrency } from '../utils/concurrency.util';
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

  private downloadProgressSubject = new Subject<DownloadProgress>();

  // Public observable for components to subscribe
  downloadProgress$ = this.downloadProgressSubject.asObservable();

  /** Emits each track right after it lands on the device (NativeAudioEngine swaps its queue entry to the local file). */
  readonly trackDownloaded$ = new Subject<Track>();

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
        items: tracks.map(t => ({ id: t.id, url: t.url, fileName: idToFileName(t.id) })),
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
      void audioStorage.markStored(id, size);
      const track = this.bulkTracks.get(id);
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

  async ensureFreeDiskSpace(): Promise<void> {
    const space = new AvailableSpace();

    while(!await space.isSafe()) {
      console.warn(`AudioDownloaderService::ensureFreeDiskSpace -> You have only ${await space.inMB()}Mb of storage left. Removing 3 oldest audios`);
      const removed = await this.removeOldest(3); // remove the oldest three tracks
      // Nothing left to evict: the space is taken by something else (or, in
      // the native app, the WebView quota estimate doesn't even cover the
      // audio files). Looping here would spin forever and hang every
      // download waiting on it — let the download try and fail on its own.
      if (removed.length === 0) return;
      // little pause to ensure Safari updates our usage
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async removeById(trackId: string): Promise<void> {
    await audioStorage.remove(trackId);
    console.log(`Removed file ${trackId} from cache`);
  }

  async removeOldest(count: number = 1): Promise<string[]> {
    const sorted = (await audioStorage.list()).sort((a, b) => a.downloadedAt - b.downloadedAt);
    const removedIds: string[] = [];
    for (const oldest of sorted.slice(0, count)) {
      await audioStorage.remove(oldest.id);
      removedIds.push(oldest.id);
    }
    console.log(`Removed ${removedIds.length} oldest file(s):`, removedIds);
    return removedIds;
  }

  /** Check if already downloaded (`fileName` is the legacy IndexedDB key). */
  async isDownloaded(track: Track): Promise<boolean> {
    return (await audioStorage.has(track.id)) || (!!track.fileName && await audioStorage.has(track.fileName));
  }

  /** A URL the player can open for this track if it's on the device, else null. */
  async localUrl(track: Track): Promise<string | null> {
    return (await audioStorage.playableUrl(track.id)) ||
      (track.fileName ? await audioStorage.playableUrl(track.fileName) : null);
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
