import { Injectable } from '@angular/core';
import { openDB } from 'idb';
import { BibleBooks } from '../data/bible-books';
import { Track } from '../models/track';

@Injectable({ providedIn: 'root' })
export class AudioDownloaderService {
  private db = openDB('audio-db', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    },
  });

  async getAllTracks(): Promise<Track[]> {
    const tracks: Track[] = [];

    for (const book of BibleBooks) {
      for (let chapter = 1; chapter <= book.chapterCount; chapter++) {
        const title = `${book.title} ${chapter}`;
        let track: Track = {
          book: book.title,
          chapter,
          title,
          fileName: `${title}.mp3`,
          url: `https://nlabs.live:3003/assets/bible/audio/${encodeURIComponent(book.title)}/${encodeURIComponent(title)}.mp3`,
          status: 'pending'
        };

        let downloaded = await this.isDownloaded(track);

        if(downloaded) track.status = "done";

        tracks.push(track);
      }
    }

    return tracks;
  }

  /** Download a single chapter */
  async download(track: Track): Promise<void> {
    track.status = 'downloading';
    const response = await fetch(track.url, { mode: 'cors' });
    if (!response.ok) {
      track.status = 'error';
      console.error(`Falha: ${track.title}`, response);
      throw new Error(`Falha: ${track.title}`);
    }

    const blob = new Blob([await response.blob()], { type: 'audio/mpeg' });
    const db = await this.db;
    await db.put('files', {
      id: track.fileName,
      blob,
      url: track.url,
      downloadedAt: Date.now()
    });

    track.status = "done";
  }

  /** Check if already downloaded */
  async isDownloaded(track: Track): Promise<boolean> {
    const db = await this.db;
    return !!(await db.get('files', track.fileName));
  }

  /** Total downloaded chapters */
  async getDownloadedCount(): Promise<number> {
    const db = await this.db;
    return (await db.getAllKeys('files')).length;
  }

  async downloadEntireBible(onProgress?: (done: number, total: number) => void) {
    const tracks = await this.getAllTracks();
    let done = 0;

    for (const track of tracks) {
      if (!(await this.isDownloaded(track))) {
        try {
          await this.download(track);
        } catch (e) {
          console.warn('Ignorado (baixará sob demanda):', track.title);
        }
      }
      done++;
      onProgress?.(done, tracks.length);
    }
  }
}
