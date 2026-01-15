import { Injectable } from '@angular/core';
import { dbPromise } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';
import { Track } from '../models/track';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audio = new Audio();
  private audio2 = new Audio(); // for seamless next track in background/locked screen
  private activeAudio: HTMLAudioElement = this.audio;
  private inactiveAudio: HTMLAudioElement = this.audio2;
  private nextTrackToPreload: Track | null = null;
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
    const attachEvents = (el: HTMLAudioElement) => {
      el.addEventListener('timeupdate', () => {
        if (el === this.activeAudio) {
          this.timeUpdate$.next({
            currentTime: Math.floor(el.currentTime),
            duration: Math.floor(el.duration) || 0,
          });
        }
      });

      el.addEventListener('play', () => {
        if (el === this.activeAudio) {
          this.isPlaying$.next(true);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        }
      });

      el.addEventListener('pause', () => {
        if (el === this.activeAudio) {
          this.isPlaying$.next(false);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        }
      });

      el.addEventListener('ended', () => this.handleTrackEnded(el));
    };

    attachEvents(this.audio);
    attachEvents(this.audio2);

    this.setupMediaSession();

    // Optional: refresh media session when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.setupMediaSession();
      }
    });
  }

  // === PLAYBACK PRINCIPAL ===
  async playTrack(track: Track, playlist?: Track[], startIndex = 0) {
    this.stop();

    if (playlist) {
      this.playlist = playlist;
      this.index = startIndex;
    }

    const targetAudio = this.inactiveAudio;

    const db = await dbPromise;
    let stored = await db.get('files', track.id || track.fileName);
    let url: string;

    if (stored?.blob) {
      url = URL.createObjectURL(stored.blob);
      console.log('Tocando offline:', track.title);
    } else {
      console.log('Baixando:', track.title);
      await this.downloader.download(track);
      stored = await db.get('files', track.id || track.fileName);
      if (stored?.blob) {
        url = URL.createObjectURL(stored.blob);
      } else {
        url = track.url;
        console.log('Download falhou... Tocando online:', track.title);
      }
    }

    targetAudio.src = url;
    this.currentUrl = url;

    try {
      await targetAudio.play();
      console.log('Started playing on', targetAudio === this.audio ? 'audio1' : 'audio2');

      this.swapAudioElements(); // now activeAudio === targetAudio

      this.currentTrack$.next(track);
      this.updateMediaSession(track);
      this.setupMediaSession();

      this.preloadNextIfPossible();
    } catch (err) {
      console.error('Initial play failed:', err);
    }
  }

  // === CONTROLES ===
  play() {
    this.activeAudio.play().catch(err => console.warn('Play failed:', err));
  }

  pause() {
    this.activeAudio.pause();
  }

  toggle() {
    if (this.activeAudio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  stop() {
    this.activeAudio.pause();
    this.activeAudio.removeAttribute('src');
    this.activeAudio.load();

    this.inactiveAudio.pause();
    this.inactiveAudio.removeAttribute('src');
    this.inactiveAudio.load();

    if (this.currentUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentUrl);
    }
    this.currentUrl = '';
  }

  seekTo(seconds: number) {
    this.activeAudio.currentTime = seconds;
    this.timeUpdate$.next({
      currentTime: Math.floor(this.activeAudio.currentTime),
      duration: Math.floor(this.activeAudio.duration) || 0,
    });
  }

  skip(seconds: number) {
    const newTime = this.activeAudio.currentTime + seconds;
    this.activeAudio.currentTime = Math.max(0, Math.min(newTime, this.activeAudio.duration));
    this.timeUpdate$.next({
      currentTime: Math.floor(this.activeAudio.currentTime),
      duration: Math.floor(this.activeAudio.duration) || 0,
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

  // === MEDIA SESSION ===
  private setupMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
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
          { src: '/assets/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
          { src: '/assets/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        ]
      });
    }
  }

  // === DUAL AUDIO HELPERS ===
  private swapAudioElements() {
    [this.activeAudio, this.inactiveAudio] = [this.inactiveAudio, this.activeAudio];
    // Clean the NEW inactive (old active)
    this.inactiveAudio.pause();
    this.inactiveAudio.removeAttribute('src');
    this.inactiveAudio.load();
    // Revoke old blob if applicable
    if (this.currentUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentUrl);
    }
  }

  private handleTrackEnded(endedEl: HTMLAudioElement) {
    if (endedEl !== this.activeAudio) return;

    const endedTrack = this.currentTrack$.value;
    if (endedTrack) this.trackEndedSource.next(endedTrack);

    this.isPlaying$.next(false);

    if (this.playlist.length === 0 || this.index >= this.playlist.length - 1) {
      this.stop();
      return;
    }

    this.index = (this.index + 1) % this.playlist.length;

    this.swapAudioElements();

    this.activeAudio.play()
      .then(() => {
        console.log('Seamless next track started');
      })
      .catch(err => {
        console.warn('Next play failed after swap', err.name, err.message);
        // Retry after small delay
        setTimeout(() => {
          this.activeAudio.play().catch(e => {
            console.error('Retry failed', e);
            // Final fallback
            this.playTrack(this.playlist[this.index], this.playlist, this.index);
          });
        }, 500);
      });

    const newTrack = this.playlist[this.index];
    this.currentTrack$.next(newTrack);
    this.updateMediaSession(newTrack);

    this.preloadNextIfPossible();
  }

  private async preloadNextIfPossible() {
    if (this.playlist.length <= this.index + 1) return;

    const nextTrack = this.playlist[this.index + 1];
    if (nextTrack === this.nextTrackToPreload) return;

    this.nextTrackToPreload = nextTrack;

    const db = await dbPromise;
    let stored = await db.get('files', nextTrack.id || nextTrack.fileName);
    let url: string;

    if (!stored?.blob) {
      console.log('Pre-downloading next track for better background playback:', nextTrack.title);
      await this.downloader.download(nextTrack).catch(() => {});
      stored = await db.get('files', nextTrack.id || nextTrack.fileName);
    }

    url = stored?.blob ? URL.createObjectURL(stored.blob) : nextTrack.url;

    this.inactiveAudio.src = url;
    this.inactiveAudio.load();
    this.inactiveAudio.preload = 'auto';
    console.log('Preloading next:', nextTrack.title, url.startsWith('blob:') ? '(offline)' : '(online)');
  }
}