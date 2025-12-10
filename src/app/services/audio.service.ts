import { Injectable } from '@angular/core';
import { dbPromise } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';
import { Track } from '../models/track';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audio = new Audio();
  private currentUrl = '';

  // === ESTADO PÚBLICO (para o player consumir) ===
  currentTrack$ = new BehaviorSubject<Track | null>(null);
  isPlaying$ = new BehaviorSubject<boolean>(false);
  timeUpdate$ = new BehaviorSubject<{ currentTime: number; duration: number }>({
    currentTime: 0,
    duration: 0,
  });

  // === PLAYLIST ===
  private playlist: Track[] = [];
  private index = 0;

  // === EVENTO DE FINALIZAÇÃO ===
  private trackEndedSource = new BehaviorSubject<Track | null>(null);
  trackEnded$ = this.trackEndedSource.asObservable();


  constructor(private downloader: AudioDownloaderService) {
    // Atualiza tempo em tempo real
    this.audio.addEventListener('timeupdate', () => {
      this.timeUpdate$.next({
        currentTime: Math.floor(this.audio.currentTime),
        duration: Math.floor(this.audio.duration) || 0,
      });
    });

    // Atualiza estado de play/pause
    this.audio.addEventListener('play', () => this.isPlaying$.next(true));
    this.audio.addEventListener('pause', () => this.isPlaying$.next(false));
    this.audio.addEventListener('ended', () => {
      if(this.playlist[this.index])
        this.trackEndedSource.next(this.playlist[this.index]);

      this.isPlaying$.next(false);
      this.next(); // continua a playlist
    });

    this.setupMediaSession();
  }

  // === PLAYBACK PRINCIPAL ===
  async playTrack(track: Track, playlist?: Track[], startIndex = 0) {
    this.stop();

    if (playlist) {
      this.playlist = playlist;
      this.index = startIndex;
    }

    const db = await dbPromise;
    let stored = await db.get('files', track.id || track.fileName);

    if (stored?.blob) {
      this.currentUrl = URL.createObjectURL(stored.blob);
      console.log('Tocando offline:', track.title);
    } else {
      console.log('Baixando: ', track.title);
      await this.downloader.download(track);
      stored = await db.get('files', track.id || track.fileName);
      if(stored?.blob)
        this.currentUrl = URL.createObjectURL(stored.blob);
      else {
        this.currentUrl = track.url;
        console.log('Download falhou... Tocando online:', track.title);
      }
    }

    this.audio.src = this.currentUrl;
    await this.audio.play();

    this.currentTrack$.next(track);
    this.updateMediaSession(track);
  }

  // === CONTROLES ===
  pause() {
    this.audio.pause();
  }

  play() {
    this.audio.play();
  }

  toggle() {
    this.audio.paused ? this.play() : this.pause();
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();

    if (this.currentUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentUrl);
    }
    this.currentUrl = '';
  }

  seekTo(seconds: number) {
    this.audio.currentTime = seconds;
    this.timeUpdate$.next({
      currentTime: seconds,
      duration: Math.floor(this.audio.duration) || 0,
    });
  }

  skip(seconds: number) {
    const newTime = this.audio.currentTime + seconds;
    this.audio.currentTime = Math.max(0, Math.min(newTime, this.audio.duration));
    this.timeUpdate$.next({
      currentTime: Math.floor(this.audio.currentTime),
      duration: Math.floor(this.audio.duration) || 0,
    });
  }

  // === PLAYLIST ===
  setPlaylist(tracks: Track[], startIndex = 0) {
    this.playlist = tracks;
    this.index = startIndex;
  }

  async playPlaylist(tracks: Track[], startIndex = 0) {
    this.setPlaylist(tracks, startIndex);
    if (tracks.length > 0) {
      await this.playTrack(tracks[startIndex], tracks, startIndex);
    }
  }

  next() {
    if (this.playlist.length === 0) return;
    this.index = (this.index + 1) % this.playlist.length;
    this.playTrack(this.playlist[this.index], this.playlist, this.index);
  }

  previous() {
    if (this.playlist.length === 0) return;
    this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
    this.playTrack(this.playlist[this.index], this.playlist, this.index);
  }

  hasNext(): boolean {
    return this.playlist.length > 1 && this.index < this.playlist.length - 1;
  }

  hasPrevious(): boolean {
    return this.playlist.length > 1 && this.index > 0;
  }

  // === MEDIA SESSION (botões do carro, fone, lock screen) ===
  private setupMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekforward', () => this.skip(10));
      navigator.mediaSession.setActionHandler('seekbackward', () => this.skip(-10));
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) this.seekTo(details.seekTime);
      });
    }
  }

  private updateMediaSession(track: Track) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: 'Bíblia em Áudio',
        album: track.title || track.fileName,
        artwork: [
          { src: '/assets/icons/icon-96x96.png',   sizes: '96x96',   type: 'image/png' },
          { src: '/assets/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        ]
      });
    }
  }
}
