import { Injectable } from '@angular/core';
import { dbPromise, AvailableSpace } from '../storage/my-db';
import { Track } from '../models/track';
import { bypassServiceWorker } from '../utils/sw-bypass.util';
import { runWithConcurrency } from '../utils/concurrency.util';
import { Subject } from 'rxjs';

/** An AbortSignal that trips as soon as either input signal does. */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  a.addEventListener('abort', () => controller.abort(a.reason), { once: true });
  b.addEventListener('abort', () => controller.abort(b.reason), { once: true });
  return controller.signal;
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

  private downloadProgressSubject = new Subject<{
    downloaded: number;
    total: number;
    status: 'idle' | 'running' | 'completed' | 'error';
    currentTrack?: Track;
    // Distinguishes a full-Bible download (downloadEntireBible) from any
    // other batch (e.g. the chapters/book the user just tapped in the
    // picker) — both go through downloadTracks() and this same subject, so
    // UI that only cares about "the whole Bible is done" (the hero header's
    // success banner) needs this to avoid firing after a single chapter.
    context?: 'full-bible' | 'selection';
  }>();

  // Public observable for components to subscribe
  downloadProgress$ = this.downloadProgressSubject.asObservable();

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
    let downloaded = await this.isDownloaded(track);
    if(downloaded) {
      track.status = "done";
      return;
    }

    await this.ensureFreeDiskSpace();

    track.status = 'downloading';
    const timeoutSignal = AbortSignal.timeout(120_000);
    // Query-param bypass only. A custom `ngsw-bypass` header would trigger a
    // CORS preflight against the R2 CDN and can fail the download entirely.
    const response = await fetch(bypassServiceWorker(track.url), {
      mode: 'cors',
      cache: 'no-store',
      signal: signal ? combineSignals(timeoutSignal, signal) : timeoutSignal,
    });
    if (!response.ok) {
      track.status = 'error';
      console.error(`Falha: ${track.title}`, response);
      throw new Error(`Falha: ${track.title}`);
    }

    const blob = new Blob([await response.blob()], { type: 'audio/mpeg' });
    const db = await dbPromise;
    await db.put('files', {
      id: track.id || track.fileName,
      blob,
      url: track.url,
      downloadedAt: Date.now()
    });

    track.status = "done";
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
    const watchdog = setInterval(checkStalled, AudioDownloaderService.STALL_CHECK_INTERVAL_MS);
    // Re-check the instant the tab is foregrounded again instead of waiting
    // for the next watchdog tick, so the button reappears right on unlock.
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkStalled();
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
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
    }

    if (stallController.signal.aborted) {
      this.reportProgress(downloadedCount, total, undefined, 'error', context);
      return;
    }

    // Final update
    this.reportProgress(downloadedCount, total, undefined, 'completed', context);
  }

  async ensureFreeDiskSpace(): Promise<void> {
    const space = new AvailableSpace();

    while(!await space.isSafe()) {
      console.warn(`AudioDownloaderService::ensureFreeDiskSpace -> You have only ${await space.inMB()}Mb of storage left. Removing 3 oldest audios`);
      await this.removeOldest(3); // remove the oldest three tracks
      // little pause to ensure Safari updates our usage
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async removeById(trackId: string): Promise<void> {
    const db = await dbPromise;
    await db.delete('files', trackId);
    console.log(`Removed file ${trackId} from cache`);
  }

  async removeOldest(count: number = 1): Promise<string[]> {
    const db = await dbPromise;
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');

    // Get all entries, sort by downloadedAt (oldest first)
    const all = await store.getAll();
    const sorted = all.sort((a, b) => a.downloadedAt - b.downloadedAt);

    const removedIds: string[] = [];

    for (let i = 0; i < count && i < sorted.length; i++) {
      const oldest = sorted[i];
      await store.delete(oldest.id);
      removedIds.push(oldest.id);
    }

    await tx.done;
    console.log(`Removed ${removedIds.length} oldest file(s):`, removedIds);
    return removedIds;
  }

  /** Check if already downloaded */
  async isDownloaded(track: Track): Promise<boolean> {
    const db = await dbPromise;
    return !!(await db.get('files', track.id) ||
              await db.get('files', track.fileName));
  }

  async areDownloaded(tracks: Track[]): Promise<{total: number, pendingCount: number, pending: string[]}> {
    const db = await dbPromise;
    let res: {total: number, pendingCount: 0, pending: string[]} = {total: 0, pendingCount: 0, pending: []};
    for(let track of tracks) {
      const done = await this.isDownloaded(track);
      if(done)
        res.total += 1;
      else {
        res.pendingCount += 1;
        res.pending.push(track.id);
      }
    }
    return res;
  }

  /** Total downloaded chapters */
  async getDownloadedCount(): Promise<number> {
    const db = await dbPromise;
    return (await db.getAllKeys('files')).length;
  }

  private reportProgress(
    downloaded: number,
    total: number,
    currentTrack?: Track,
    status: 'idle' | 'running' | 'completed' | 'error' = 'running',
    context?: 'full-bible' | 'selection'
  ) {
    this.downloadProgressSubject.next({
      downloaded,
      total,
      currentTrack,
      status,
      context
    });
  }
}
