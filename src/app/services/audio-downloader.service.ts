import { Injectable } from '@angular/core';
import { dbPromise, AvailableSpace } from '../storage/my-db';
import { Track } from '../models/track';

@Injectable({ providedIn: 'root' })
export class AudioDownloaderService {
  private tracks: Track[] = [];

  setTracks(tracks: Track[]) {
    this.tracks = tracks;
  }
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

  async ensureFreeDiskSpace(): Promise<void> {
    const space = new AvailableSpace();

    while(!await space.isSafe()) {
      console.warn(`AudioDownloaderService::ensureFreeDiskSpace -> You have only ${await space.inMB()}Mb of storage left. Removing 3 oldest audios`);
      await this.removeOldest(3); // remove the oldest three tracks
      // little pause to ensure Safari updates our usage
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async downloadTracks(tracks: Track[]): Promise<void> {
    for(let track of tracks)
      await this.download(track);
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
}
