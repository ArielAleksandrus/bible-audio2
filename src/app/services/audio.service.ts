import { Injectable } from '@angular/core';
import { openDB } from 'idb';
import { AudioDownloaderService } from './audio-downloader.service';
import { Track } from '../models/track';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audio = new Audio();
  private currentUrl = '';
  private db = openDB('audio-db', 1);

  currentTrack$ = new BehaviorSubject<Track | null>(null);
  private playlist: Track[] = [];
  private index = 0;

  constructor(private downloader: AudioDownloaderService) {
    this.audio.addEventListener('ended', () => this.next());
    this.setupMediaSession();
  }

  // === PLAYBACK ===
  async playTrack(track: Track) {
    this.stop(); // clean previous

    const db = await this.db;
    const stored = await db.get('files', track.fileName);

    if (stored?.blob) {
      this.currentUrl = URL.createObjectURL(stored.blob);
      console.log('Offline:', track);
    } else {
      this.currentUrl = track.url;
      console.log('Online:', track.title);
      // Auto-download in background so next time it's offline
      this.downloader.download(track).catch(() => {});
    }

    this.audio.src = this.currentUrl;
    await this.audio.play();

    this.currentTrack$.next(track);
    this.updateMediaSession(track);
  }

  // === PLAYLIST CONTROL ===
  setPlaylist(tracks: Track[], startIndex = 0) {
    this.playlist = tracks;
    this.index = startIndex;
  }

  async playPlaylist(tracks: Track[], startIndex = 0) {
    this.setPlaylist(tracks, startIndex);
    await this.playCurrent();
  }

  private async playCurrent() {
    if (this.playlist.length === 0) return;
    await this.playTrack(this.playlist[this.index]);
  }

  next() {
    this.index = (this.index + 1) % this.playlist.length;
    this.playCurrent();
  }

  previous() {
    this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
    this.playCurrent();
  }

  pause() { this.audio.pause(); }
  play() { this.audio.play(); }
  stop() {
    this.audio.pause();
    this.audio.src = '';
    if (this.currentUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentUrl);
    }
    this.currentUrl = '';
  }

  // === MEDIA SESSION (car buttons + lock screen) ===
  private setupMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    }
  }

  private updateMediaSession(track: Track) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: 'Bíblia em Áudio',
        album: 'Bíblia Completa',
        artwork: [
          { src: '/assets/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        ]
      });
    }
  }
}
