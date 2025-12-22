import { Injectable } from '@angular/core';
import { dbPromise, AvailableSpace } from '../storage/my-db';
import { Track } from '../models/track';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AudioDownloaderService {
  private tracks: Track[] = [];

  private downloadProgressSubject = new Subject<{
    downloaded: number;
    total: number;
    status: 'idle' | 'running' | 'completed' | 'error';
    currentTrack?: Track;
  }>();

  // Public observable for components to subscribe
  downloadProgress$ = this.downloadProgressSubject.asObservable();

  getTracks(): Track[] {
    return this.tracks;
  }

  /** Download a single track */
  async download(track: Track): Promise<void> {
    let downloaded = await this.isDownloaded(track);
    if(downloaded) {
      track.status = "done";
      return;
    }

    await this.ensureFreeDiskSpace();

    track.status = 'downloading';
    const response = await fetch(track.url, { mode: 'cors' });
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

  async downloadTracks(tracks: Track[]): Promise<void> {
    this.tracks = tracks;

    const total = tracks.length;
    let downloadedCount = 0;

    // First, count how many are already downloaded
    const alreadyDone = await this.areDownloaded(tracks);
    downloadedCount = total - alreadyDone.pendingCount;

    this.reportProgress(downloadedCount, total);

    // Download only the pending ones
    for (const track of tracks) {
      if (await this.isDownloaded(track)) {
        continue; // skip already downloaded
      }

      try {
        this.reportProgress(downloadedCount, total, track); // show current track
        await this.download(track);
        downloadedCount++;
        this.reportProgress(downloadedCount, total); // update downloaded count
      } catch (err) {
        console.error('Failed to download track', track, err);
        // Decide: continue or stop? Here we continue
        track.status = 'error';
        this.reportProgress(downloadedCount, total, track);
      }

      // small yield to keep UI responsive
      await new Promise(resolve => requestAnimationFrame(resolve));
    }

    // Final update
    this.reportProgress(downloadedCount, total);
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

  private reportProgress(downloaded: number, total: number, currentTrack?: Track) {
    this.downloadProgressSubject.next({
      downloaded,
      total,
      currentTrack,
      status: 'running'
    });
  }
  private completeProgress(downloaded: number, total: number) {
    this.downloadProgressSubject.next({
      downloaded,
      total,
      status: 'completed'
    });
  }
}
