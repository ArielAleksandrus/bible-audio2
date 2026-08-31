import { Injectable } from '@angular/core';
import { dbPromise } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';
import { Track } from '../models/track';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audio = new Audio();
  private audio2 = new Audio(); // preloads the next chapter for locked-screen / background
  private activeAudio: HTMLAudioElement = this.audio;
  private inactiveAudio: HTMLAudioElement = this.audio2;
  private blobUrlByEl = new WeakMap<HTMLAudioElement, string>();
  private preloaded: { track: Track; url: string } | null = null;
  private preloadGeneration = 0;
  /** When false, `ended` must not auto-advance (stop/load can fire spurious ended). */
  private autoAdvance = false;

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

  constructor(private downloader: AudioDownloaderService, private analytics: AnalyticsService) {
    this.prepareAudioElement(this.audio);
    this.prepareAudioElement(this.audio2);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.activeAudio.paused) {
        this.isPlaying$.next(true);  // in case browser muted/reset state
      }
    });

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

      el.addEventListener('playing', () => {
        if (el === this.activeAudio) {
          this.isPlaying$.next(true);
        }
      });

      el.addEventListener('pause', () => {
        if (el === this.activeAudio) {
          this.isPlaying$.next(false);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        }
      });

      el.addEventListener('ended', () => this.handleTrackEnded(el));

      el.addEventListener('error', (e) => {
        console.error('Audio error on', el === this.audio ? 'audio1' : 'audio2', e);
      });
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
    // Ignore `ended` from tearing down the previous source (Safari/Chrome fire it on load()).
    this.autoAdvance = false;
    this.invalidatePreload();
    this.clearElement(this.inactiveAudio);

    if (playlist) {
      this.playlist = playlist;
      this.index = startIndex;
    } else {
      const idx = this.playlist.findIndex(t => t.id === track.id);
      if (idx >= 0) this.index = idx;
    }

    const url = await this.resolvePlayUrl(track);
    this.setAudioSource(this.activeAudio, url);

    try {
      await this.activeAudio.play();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      console.log('Started playing', track.title);
      this.onStarted(track);
      void this.preloadNextIfPossible();
    } catch (err) {
      this.isPlaying$.next(false);
      console.error('Initial play failed:', err);
    }
  }

  // === CONTROLES ===
  play() {
    this.activeAudio.play().catch(err => console.warn('Play failed:', err));
    if ('setPositionState' in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({
        duration: this.activeAudio.duration || 0,
        playbackRate: 1.0,
        position: this.activeAudio.currentTime
      });
    }
  }

  pause() {
    this.activeAudio.pause();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }

  toggle() {
    if (this.activeAudio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  stop() {
    this.autoAdvance = false;
    this.invalidatePreload();
    this.clearElement(this.activeAudio);
    this.clearElement(this.inactiveAudio);
    this.isPlaying$.next(false);
  }

  seekTo(seconds: number) {
    this.activeAudio.currentTime = seconds;
    this.timeUpdate$.next({
      currentTime: Math.floor(this.activeAudio.currentTime),
      duration: Math.floor(this.activeAudio.duration) || 0,
    });
    if ('setPositionState' in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({
        duration: this.activeAudio.duration || 0,
        playbackRate: 1.0,
        position: this.activeAudio.currentTime
      });
    }
  }

  skip(seconds: number) {
    const newTime = this.activeAudio.currentTime + seconds;
    this.activeAudio.currentTime = Math.max(0, Math.min(newTime, this.activeAudio.duration));
    this.timeUpdate$.next({
      currentTime: Math.floor(this.activeAudio.currentTime),
      duration: Math.floor(this.activeAudio.duration) || 0,
    });
    if ('setPositionState' in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({
        duration: this.activeAudio.duration || 0,
        playbackRate: 1.0,
        position: this.activeAudio.currentTime
      });
    }
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
    this.startNextTrack(this.playlist[this.index]);
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
  private prepareAudioElement(el: HTMLAudioElement) {
    el.preload = 'auto';
    el.setAttribute('playsinline', 'true');
  }

  private onStarted(track: Track) {
    this.autoAdvance = true;
    this.isPlaying$.next(true);
    this.currentTrack$.next(track);
    this.updateMediaSession(track);
    this.setupMediaSession();
  }

  private setAudioSource(el: HTMLAudioElement, url: string) {
    const prev = this.blobUrlByEl.get(el);
    if (prev && prev !== url) {
      URL.revokeObjectURL(prev);
      this.blobUrlByEl.delete(el);
    }
    el.src = url;
    el.preload = 'auto';
    if (url.startsWith('blob:')) {
      this.blobUrlByEl.set(el, url);
    } else {
      this.blobUrlByEl.delete(el);
    }
  }

  private clearElement(el: HTMLAudioElement, revokeBlob = true) {
    el.pause();
    const blob = this.blobUrlByEl.get(el);
    if (blob) {
      this.blobUrlByEl.delete(el);
      if (revokeBlob) URL.revokeObjectURL(blob);
    }
    el.removeAttribute('src');
    el.load();
  }

  private invalidatePreload() {
    this.preloadGeneration++;
    this.preloaded = null;
  }

  /**
   * Prefer a cached blob; otherwise stream from the CDN immediately.
   * Never block playback on a full download — that loses the autoplay gesture.
   */
  private async resolvePlayUrl(track: Track): Promise<string> {
    try {
      const db = await dbPromise;
      const stored = await db.get('files', track.id || track.fileName);
      if (stored?.blob) {
        return URL.createObjectURL(stored.blob);
      }
    } catch (err) {
      console.warn('Failed to read cached audio, falling back to network:', err);
    }
    void this.downloader.download(track).catch(() => {});
    return track.url;
  }

  private handleTrackEnded(endedEl: HTMLAudioElement) {
    if (!this.autoAdvance) return;
    if (endedEl !== this.activeAudio) return;
    if (!endedEl.currentSrc) return;

    const endedTrack = this.currentTrack$.value;
    if (endedTrack) {
      this.trackEndedSource.next(endedTrack);
      this.analytics.chapterCompleted(endedTrack.book, endedTrack.chapter);
    }

    if (this.playlist.length === 0 || this.index >= this.playlist.length - 1) {
      this.isPlaying$.next(false);
      this.autoAdvance = false;
      return;
    }

    this.index += 1;
    this.startNextTrack(this.playlist[this.index]);
  }

  /**
   * Start the next chapter without awaiting IndexedDB/network first.
   * Browsers only allow autoplay continuation if play() is called
   * synchronously from the `ended` handler (especially iOS / locked screen).
   *
   * Dual-element swap is used only when the next source is already loaded;
   * otherwise we reuse the element that just ended (same-element fallback).
   */
  private startNextTrack(track: Track) {
    const preloaded = this.preloaded?.track === track ? this.preloaded : null;

    if (preloaded && this.inactiveAudio.src) {
      // Cancel in-flight preload writes so they cannot clobber this element.
      this.preloadGeneration++;
      const playPromise = this.inactiveAudio.play();
      playPromise
        .then(() => {
          console.log('Seamless next track started:', track.title);
          this.preloaded = null;
          this.adoptInactiveAsActive();
          this.onStarted(track);
          void this.preloadNextIfPossible();
        })
        .catch(err => {
          console.warn('Seamless next failed, using same element:', err?.name, err?.message);
          this.playOnActiveNow(track, preloaded.url);
        });
      return;
    }

    this.playOnActiveNow(track, preloaded?.url ?? track.url);
  }

  private playOnActiveNow(track: Track, url: string) {
    const inactiveBlob = this.blobUrlByEl.get(this.inactiveAudio);
    const transferringBlob = inactiveBlob === url;
    this.invalidatePreload();
    this.clearElement(this.inactiveAudio, !transferringBlob);
    this.setAudioSource(this.activeAudio, url);

    this.activeAudio.play()
      .then(() => {
        console.log('Next track started (same element):', track.title);
        this.onStarted(track);
        void this.preloadNextIfPossible();
      })
      .catch(async err => {
        console.warn('Same-element next failed, trying cached blob:', err?.name, err?.message);
        try {
          const blobUrl = await this.resolvePlayUrl(track);
          if (blobUrl === url) throw err;
          this.setAudioSource(this.activeAudio, blobUrl);
          await this.activeAudio.play();
          this.onStarted(track);
          void this.preloadNextIfPossible();
        } catch (err2) {
          console.error('Failed to start next track', err2);
          this.isPlaying$.next(false);
        }
      });
  }

  private adoptInactiveAsActive() {
    const oldActive = this.activeAudio;
    this.activeAudio = this.inactiveAudio;
    this.inactiveAudio = oldActive;
    this.clearElement(oldActive);
  }

  private async preloadNextIfPossible() {
    if (this.playlist.length <= this.index + 1) return;

    const nextTrack = this.playlist[this.index + 1];
    if (this.preloaded?.track === nextTrack && this.inactiveAudio.src) return;

    const gen = ++this.preloadGeneration;
    const url = await this.resolvePlayUrl(nextTrack);

    if (gen !== this.preloadGeneration) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      return;
    }
    if (this.playlist[this.index + 1] !== nextTrack) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      return;
    }

    this.setAudioSource(this.inactiveAudio, url);
    this.inactiveAudio.load();
    this.preloaded = { track: nextTrack, url };
    console.log('Preloading next:', nextTrack.title, url.startsWith('blob:') ? '(offline)' : '(online)');
  }
}
