import { Injectable } from '@angular/core';
import { dbPromise } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';
import { Track } from '../models/track';
import { bypassServiceWorker } from '../utils/sw-bypass.util';
import { silentWavBlob } from '../utils/silent-wav.util';
import { BehaviorSubject } from 'rxjs';

/**
 * Play silence on the other element this many seconds before the current
 * chapter ends, so the media session never goes idle. Must be shorter than
 * SILENCE_S so any leaked audio is still silence, not "Atos capítulo 1".
 */
const PRIME_REMAINING_S = 0.9;
const SILENCE_S = 1.25;

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audio = new Audio();
  private audio2 = new Audio(); // preloads/primes the next chapter so playback never stops
  private activeAudio: HTMLAudioElement = this.audio;
  private inactiveAudio: HTMLAudioElement = this.audio2;
  private blobUrlByEl = new WeakMap<HTMLAudioElement, string>();
  private preloaded: { track: Track; url: string; ready: boolean } | null = null;
  private preloadGeneration = 0;
  /** When false, `ended` must not auto-advance (stop/load can fire spurious ended). */
  private autoAdvance = false;
  /**
   * True from the moment a chapter ends (or skip is requested) until shortly
   * after the next chapter is actually playing. During this window the OS /
   * phone media session often fires a spurious `pause` because it saw the
   * previous element stop — especially on the phone speaker, where nothing
   * like a car Bluetooth head unit is keeping the session alive.
   */
  private transitioning = false;
  /**
   * True only while we are in the middle of starting the next chapter
   * (ended handler or next() already running). Prevents a Bluetooth
   * `nexttrack` plus `ended` from skipping two chapters. Cleared as soon
   * as the new chapter starts so the in-app next button stays responsive.
   */
  private advancing = false;
  /** Set only by the in-app / explicit pause() so we never auto-resume a real pause. */
  private userPaused = false;
  /**
   * Next chapter is already playing (volume 0) on the inactive element while
   * the current one finishes. Playback never actually stops, which is what
   * mobile browsers require to allow the continuation.
   */
  private nextPrimed = false;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fires even when `timeupdate` is throttled (locked screen). */
  private primeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ignore OS/media-session pause until this time (ms since epoch). */
  private holdUntil = 0;
  private silenceUrl: string | null = null;

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
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
    } catch {
      // Audio Session API is optional.
    }

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
          this.maybePrimeNext(el);
          this.schedulePrimeTimer(el);
          this.updatePositionState();
        }
      });

      el.addEventListener('loadedmetadata', () => {
        if (el === this.activeAudio) this.schedulePrimeTimer(el);
      });
      el.addEventListener('durationchange', () => {
        if (el === this.activeAudio) this.schedulePrimeTimer(el);
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
        if (el !== this.activeAudio) return;
        // The spec fires `pause` right before `ended` when a track finishes
        // naturally. Don't broadcast a "paused" state for that — it's a
        // false signal to the OS/car media session that can cause it to
        // treat playback as stopped between chapters.
        if (this.autoAdvance && el.ended) return;
        // Locked-screen Android: after we start chapter 2, the OS often
        // pauses it. Resume in this event (play() from setTimeout is blocked).
        if (this.inAdvanceHold()) {
          this.resumeSpuriousPause(el);
          return;
        }
        this.isPlaying$.next(false);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      });

      el.addEventListener('ended', () => this.handleTrackEnded(el));

      // Streamed MP3s (online, not yet in IndexedDB) sometimes never fire
      // `ended` and just stall at the last buffer. Treat that as finished.
      const maybeStuckAtEnd = () => this.maybeAdvanceIfStuckAtEnd(el);
      el.addEventListener('waiting', maybeStuckAtEnd);
      el.addEventListener('stalled', maybeStuckAtEnd);

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
    this.userPaused = false;
    this.advancing = false;
    this.clearPrimeTimer();
    this.clearTransition(false);
    this.stopPrimedNext();
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
      this.schedulePrimeTimer(this.activeAudio);
      void this.preloadNextIfPossible();
    } catch (err) {
      this.isPlaying$.next(false);
      console.error('Initial play failed:', err);
    }
  }

  // === CONTROLES ===
  play() {
    this.userPaused = false;
    this.autoAdvance = true;
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
    this.userPaused = true;
    this.advancing = false;
    this.holdUntil = 0;
    this.clearPrimeTimer();
    this.stopPrimedNext();
    this.clearTransition(false);
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
    this.userPaused = true;
    this.advancing = false;
    this.clearPrimeTimer();
    this.stopPrimedNext();
    this.clearTransition(false);
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
    if (this.advancing) return;
    this.advancing = true;
    this.clearPrimeTimer();
    this.beginTransition();
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
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => {
      // Setting this handler replaces Chrome's default pause. 1.0.2 only
      // flipped playbackState to "playing" and returned — the element stayed
      // paused, which is exactly "track 2 title + play button" on unlock.
      // play() must run in this turn; a later timer is autoplay-blocked.
      if (this.inAdvanceHold()) {
        this.resumeSpuriousPause();
        return;
      }
      this.pause();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) this.seekTo(details.seekTime);
    });
    try {
      navigator.mediaSession.setActionHandler('stop', () => {
        if (this.inAdvanceHold()) {
          this.resumeSpuriousPause();
          return;
        }
        this.pause();
      });
    } catch {
      // `stop` is not supported in every browser.
    }
  }

  private updateMediaSession(track: Track) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: 'Bíblia em Áudio',
        album: track.title || track.fileName,
        artwork: [
          { src: '/icons/android/android-launchericon-96-96.png', sizes: '96x96', type: 'image/png' },
          { src: '/icons/android/android-launchericon-192-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/android/android-launchericon-512-512.png', sizes: '512x512', type: 'image/png' },
        ]
      });
    }
  }

  // === DUAL AUDIO HELPERS ===
  private prepareAudioElement(el: HTMLAudioElement) {
    el.preload = 'auto';
    el.volume = 1;
    el.muted = false;
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    el.setAttribute('x-webkit-airplay', 'deny');
    el.disableRemotePlayback = true;
  }

  /** OS pause right after a chapter change is not a user pause. */
  private inAdvanceHold(): boolean {
    if (this.userPaused || !this.autoAdvance) return false;
    if (this.transitioning || this.nextPrimed) return true;
    return Date.now() < this.holdUntil;
  }

  /** Must run inside the pause/ended turn — setTimeout play() is blocked locked-screen. */
  private resumeSpuriousPause(el: HTMLAudioElement = this.activeAudio) {
    this.keepPlaybackStatePlaying();
    if (el.paused && !el.ended && el.currentSrc) {
      el.play().catch(err => console.warn('Resume after OS pause failed:', err?.name, err?.message));
    }
  }

  private keepPlaybackStatePlaying() {
    this.isPlaying$.next(true);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  }

  private updatePositionState() {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    const el = this.activeAudio;
    const duration = el.duration;
    if (!duration || !isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: el.playbackRate || 1,
        position: Math.min(Math.max(0, el.currentTime), duration),
      });
    } catch {
      // Browser rejects out-of-range position during src changes.
    }
  }

  private beginTransition() {
    this.transitioning = true;
    this.holdUntil = Date.now() + 4000;
    this.keepPlaybackStatePlaying();
    if (this.transitionTimer != null) clearTimeout(this.transitionTimer);
    // Failsafe: if play() never resolves (hung preload), don't ignore pause forever.
    this.transitionTimer = setTimeout(() => this.endTransition(true), 2500);
  }

  private clearTransition(resumeIfSpurious: boolean) {
    this.transitioning = false;
    this.advancing = false;
    if (this.transitionTimer != null) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (
      resumeIfSpurious &&
      this.autoAdvance &&
      !this.userPaused &&
      this.activeAudio.paused &&
      !this.activeAudio.ended &&
      this.activeAudio.currentSrc
    ) {
      console.warn('Resuming after spurious pause between chapters');
      this.activeAudio.play().catch(err => console.warn('Resume after transition failed:', err));
    }
  }

  private endTransition(tryResume: boolean) {
    this.clearTransition(tryResume);
  }

  private onStarted(track: Track) {
    this.advancing = false;
    this.nextPrimed = false;
    this.currentTrack$.next(track);
    this.updateMediaSession(track);
    this.setupMediaSession();
    if (this.userPaused) {
      // play() resolved after the user already paused; don't resume.
      this.clearTransition(false);
      return;
    }
    this.autoAdvance = true;
    this.keepPlaybackStatePlaying();
    this.updatePositionState();
    // OS pause often arrives 50–2000ms after `ended` (Now Playing / Cast when
    // online). Keep ignoring it; play() from a timer is autoplay-blocked.
    this.transitioning = true;
    this.holdUntil = Date.now() + 4000;
    if (this.transitionTimer != null) clearTimeout(this.transitionTimer);
    this.transitionTimer = setTimeout(() => this.endTransition(true), 2500);
    this.schedulePrimeTimer(this.activeAudio);
  }

  private setAudioSource(el: HTMLAudioElement, url: string) {
    const prev = this.blobUrlByEl.get(el);
    if (prev && prev !== url) {
      URL.revokeObjectURL(prev);
      this.blobUrlByEl.delete(el);
    }
    el.src = url;
    el.preload = 'auto';
    if (url.startsWith('blob:') && url !== this.silenceUrl) {
      this.blobUrlByEl.set(el, url);
    } else {
      this.blobUrlByEl.delete(el);
    }
  }

  private getSilenceUrl(): string {
    if (!this.silenceUrl) {
      this.silenceUrl = URL.createObjectURL(silentWavBlob(SILENCE_S));
    }
    return this.silenceUrl;
  }

  private clearElement(el: HTMLAudioElement, revokeBlob = true) {
    el.pause();
    el.muted = false;
    el.volume = 1;
    const blob = this.blobUrlByEl.get(el);
    if (blob && blob !== this.silenceUrl) {
      this.blobUrlByEl.delete(el);
      if (revokeBlob) URL.revokeObjectURL(blob);
    }
    el.removeAttribute('src');
    el.load();
  }

  private stopPrimedNext() {
    if (!this.nextPrimed) return;
    this.nextPrimed = false;
    this.inactiveAudio.pause();
    this.inactiveAudio.muted = false;
    this.inactiveAudio.volume = 1;
    try {
      this.inactiveAudio.currentTime = 0;
    } catch {
      // Not seekable — will restart from wherever it is if we play it later.
    }
  }

  private invalidatePreload() {
    this.preloadGeneration++;
    this.preloaded = null;
    this.stopPrimedNext();
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
    return bypassServiceWorker(track.url);
  }

  private clearPrimeTimer() {
    if (this.primeTimer != null) {
      clearTimeout(this.primeTimer);
      this.primeTimer = null;
    }
  }

  /**
   * `timeupdate` is throttled or dropped with the screen off. A timer
   * scheduled while audio is still playing is covered by Chrome's "playing
   * media" exemption and still fires, which is how we start the next
   * chapter before the current one actually stops.
   */
  private schedulePrimeTimer(el: HTMLAudioElement) {
    this.clearPrimeTimer();
    if (el !== this.activeAudio) return;
    if (!this.autoAdvance || this.userPaused || this.advancing || this.nextPrimed) return;
    if (el.paused || el.ended) return;
    const remaining = el.duration - el.currentTime;
    if (!isFinite(remaining) || remaining <= 0) return;
    const delayMs = Math.max(0, (remaining - PRIME_REMAINING_S) * 1000);
    this.primeTimer = setTimeout(() => {
      this.primeTimer = null;
      if (el !== this.activeAudio) return;
      this.maybePrimeNext(el);
    }, delayMs);
  }

  private maybeAdvanceIfStuckAtEnd(el: HTMLAudioElement) {
    if (el !== this.activeAudio) return;
    if (!this.autoAdvance || this.transitioning || this.advancing) return;
    // Still playing — do not cut the last half-second. Only waiting/stalled.
    if (!el.paused && !el.ended) return;
    const { currentTime, duration } = el;
    if (!duration || !isFinite(duration)) return;
    if (currentTime < duration - 0.35) return;
    this.handleTrackEnded(el);
  }

  /**
   * Keep the media session alive with 1s of silence on the other element
   * before the current chapter ends (1.0.3's early play, without "Atos").
   * Prime window is shorter than the silence so leaked audio is still quiet.
   */
  private maybePrimeNext(el: HTMLAudioElement) {
    if (!this.autoAdvance || this.userPaused || this.advancing || this.nextPrimed) return;
    if (el.paused || el.ended) return;
    if (el !== this.activeAudio) return;
    if (this.playlist.length <= this.index + 1) return;

    const remaining = el.duration - el.currentTime;
    if (!isFinite(remaining) || remaining > PRIME_REMAINING_S || remaining < 0) return;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;

    this.nextPrimed = true;
    this.setAudioSource(this.inactiveAudio, this.getSilenceUrl());
    this.inactiveAudio.muted = true;
    this.inactiveAudio.volume = 0;
    this.inactiveAudio.play().catch(err => {
      console.warn('Prime silence failed:', err?.name, err?.message);
    });
  }

  private handleTrackEnded(endedEl: HTMLAudioElement) {
    if (!this.autoAdvance) return;
    if (this.advancing) return;
    if (endedEl !== this.activeAudio) return;
    if (!endedEl.currentSrc) return;

    if (this.playlist.length === 0 || this.index >= this.playlist.length - 1) {
      const endedTrack = this.currentTrack$.value;
      if (endedTrack) {
        this.trackEndedSource.next(endedTrack);
        this.analytics.chapterCompleted(endedTrack.book, endedTrack.chapter);
      }
      this.isPlaying$.next(false);
      this.autoAdvance = false;
      return;
    }

    // play() must run before any other work. Plan-progress subscribers
    // (IndexedDB save, change detection) used to run first and opened a
    // gap that mobile browsers treat as a new autoplay.
    const endedTrack = this.currentTrack$.value;
    this.advancing = true;
    this.clearPrimeTimer();
    this.beginTransition();
    this.index += 1;
    this.startNextTrack(this.playlist[this.index]);

    if (endedTrack) {
      this.trackEndedSource.next(endedTrack);
      this.analytics.chapterCompleted(endedTrack.book, endedTrack.chapter);
    }
  }

  /**
   * If silence is already playing on the other element, swap in the real
   * chapter (session never went idle). Otherwise play on the element that
   * just ended. Never pause()/load() the sibling in the same turn.
   */
  private startNextTrack(track: Track) {
    if (this.nextPrimed && this.inactiveAudio.src) {
      this.takeOverPrimed(track);
      return;
    }
    const preloaded = this.preloaded?.track === track ? this.preloaded : null;
    const blobOnInactive = this.blobUrlByEl.get(this.inactiveAudio);
    const url =
      (preloaded?.url.startsWith('blob:') ? preloaded.url : null) ||
      (blobOnInactive && this.preloaded?.track === track ? blobOnInactive : null) ||
      bypassServiceWorker(track.url);
    this.playOnActiveNow(track, url);
  }

  private takeOverPrimed(track: Track) {
    this.preloadGeneration++;
    this.nextPrimed = false;
    const nextUrl =
      (this.preloaded?.track === track && this.preloaded.url.startsWith('blob:')
        ? this.preloaded.url
        : null) || bypassServiceWorker(track.url);
    this.preloaded = null;
    this.setAudioSource(this.inactiveAudio, nextUrl);
    this.inactiveAudio.muted = false;
    this.inactiveAudio.volume = 1;
    const playPromise = this.inactiveAudio.play();
    const oldActive = this.activeAudio;
    this.activeAudio = this.inactiveAudio;
    this.inactiveAudio = oldActive;
    this.activeAudio.muted = false;
    this.activeAudio.volume = 1;
    playPromise
      .then(() => {
        this.parkElement(oldActive);
        this.onStarted(track);
        this.schedulePreloadAfterSettle();
        console.log('Took over primed next chapter:', track.title);
      })
      .catch(err => {
        console.warn('Primed take-over play() failed:', err?.name, err?.message);
        this.playOnActiveNow(track, nextUrl);
      });
  }

  private isInactiveReadyFor(track: Track): boolean {
    if (this.preloaded?.track !== track) return false;
    if (!this.inactiveAudio.src) return false;
    // HAVE_CURRENT_DATA (2) is enough for play() to start; a paused,
    // off-screen element often never reaches HAVE_FUTURE_DATA (3).
    if (this.inactiveAudio.readyState < 2) return false;
    return true;
  }

  private playOnActiveNow(track: Track, url: string) {
    const inactiveBlob = this.blobUrlByEl.get(this.inactiveAudio);
    const transferringBlob = inactiveBlob === url;
    this.preloadGeneration++;
    this.preloaded = null;
    this.nextPrimed = false;
    this.setAudioSource(this.activeAudio, url);
    const playPromise = this.activeAudio.play();
    // Do not pause/load the other element here. That steals Android audio
    // focus from the play() we just issued (~0.5s of chapter 2 then stop).

    playPromise
      .then(() => {
        console.log('Next track started (same element):', track.title);
        this.parkElement(this.inactiveAudio, !transferringBlob);
        this.onStarted(track);
        this.schedulePreloadAfterSettle();
      })
      .catch(async err => {
        console.warn('Same-element next failed, trying cached blob:', err?.name, err?.message);
        if (this.userPaused) return;
        try {
          await this.activeAudio.play();
          this.parkElement(this.inactiveAudio, !transferringBlob);
          this.onStarted(track);
          this.schedulePreloadAfterSettle();
          return;
        } catch {
          // First retry of the same src failed; try a blob if we were streaming.
        }
        try {
          const blobUrl = await this.resolvePlayUrl(track);
          if (blobUrl === url) throw err;
          this.setAudioSource(this.activeAudio, blobUrl);
          await this.activeAudio.play();
          this.parkElement(this.inactiveAudio, !transferringBlob);
          this.onStarted(track);
          this.schedulePreloadAfterSettle();
        } catch (err2) {
          console.error('Failed to start next track', err2);
          this.clearTransition(false);
          this.isPlaying$.next(false);
        }
      });
  }

  /** Pause the sibling without load(). load() fires pause/ended and can stop the active player. */
  private parkElement(el: HTMLAudioElement, revokeBlob = true) {
    el.pause();
    el.muted = false;
    el.volume = 1;
    const blob = this.blobUrlByEl.get(el);
    if (blob && blob !== this.silenceUrl && revokeBlob) {
      this.blobUrlByEl.delete(el);
      URL.revokeObjectURL(blob);
      el.removeAttribute('src');
    }
  }

  private schedulePreloadAfterSettle() {
    setTimeout(() => {
      if (this.userPaused || !this.autoAdvance) return;
      void this.preloadNextIfPossible();
    }, 2000);
  }

  private adoptInactiveAsActive() {
    const oldActive = this.activeAudio;
    this.activeAudio = this.inactiveAudio;
    this.inactiveAudio = oldActive;
    this.activeAudio.muted = false;
    this.activeAudio.volume = 1;
    this.parkElement(oldActive);
  }

  /**
   * Fully materializes the next chapter into an IndexedDB blob before wiring
   * it into the inactive element, instead of just streaming the raw network
   * URL into it. A paused, off-screen <audio> element gets its network
   * buffering deprioritized by Chrome once the tab is backgrounded (screen
   * locked for car Bluetooth), so it can sit there never actually filling up;
   * a plain fetch() (what the downloader uses) isn't subject to that same
   * throttling and reliably completes in the background. Once we hold the
   * blob, the transition plays instantly and needs no further network
   * activity — the same reason offline playback never has this problem.
   */
  private async preloadNextIfPossible() {
    if (this.playlist.length <= this.index + 1) return;

    const nextTrack = this.playlist[this.index + 1];
    if (this.preloaded?.track === nextTrack && this.inactiveAudio.src) return;

    const gen = ++this.preloadGeneration;

    await this.downloader.download(nextTrack).catch(err => {
      console.warn('Failed to pre-download next track, will fall back to streaming:', err);
    });

    if (gen !== this.preloadGeneration) return;
    if (this.playlist[this.index + 1] !== nextTrack) return;

    const url = await this.resolvePlayUrl(nextTrack);

    if (gen !== this.preloadGeneration) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      return;
    }
    if (this.playlist[this.index + 1] !== nextTrack) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      return;
    }
    // Not actually buffered (download failed/never finished, so resolvePlayUrl
    // fell back to the raw network URL). Wiring that into the paused, off-screen
    // inactive element and calling it "preloaded" is exactly the silent-track
    // bug this method exists to avoid — leave preload empty and let
    // maybePrimeNext / startNextTrack stream it on an already-playing session.
    if (!url.startsWith('blob:')) {
      const upcoming = this.playlist[this.index + 2];
      if (upcoming) void this.downloader.download(upcoming).catch(() => {});
      return;
    }

    if (this.nextPrimed) {
      // Already playing the next chapter at volume 0 — don't clobber it
      // with a load() of the blob. Remember the blob for take-over fallback.
      this.preloaded = { track: nextTrack, url, ready: true };
      const upcomingWhilePrimed = this.playlist[this.index + 2];
      if (upcomingWhilePrimed) void this.downloader.download(upcomingWhilePrimed).catch(() => {});
      return;
    }

    this.setAudioSource(this.inactiveAudio, url);
    this.inactiveAudio.load();
    this.preloaded = { track: nextTrack, url, ready: false };
    const markReady = () => {
      if (this.preloaded?.track === nextTrack) this.preloaded.ready = true;
    };
    this.inactiveAudio.addEventListener('canplaythrough', markReady, { once: true });
    this.inactiveAudio.addEventListener('canplay', markReady, { once: true });
    if (this.inactiveAudio.readyState >= 2) markReady();
    console.log('Preloading next:', nextTrack.title, '(blob)');

    // Warm the chapter after next so the following boundary is also a blob.
    const upcoming = this.playlist[this.index + 2];
    if (upcoming) void this.downloader.download(upcoming).catch(() => {});
  }
}
