import { Injectable } from '@angular/core';
import { dbPromise } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';
import { Track } from '../models/track';
import { BehaviorSubject } from 'rxjs';

/** Start the next chapter this many seconds before the current one ends. */
const PRIME_REMAINING_S = 0.4;

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
   * Next chapter is already playing (muted) on the inactive element while
   * the current one finishes. Playback never actually stops, which is what
   * mobile browsers require to allow the continuation.
   */
  private nextPrimed = false;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

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
          this.maybePrimeNext(el);
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
        if (el !== this.activeAudio) return;
        // The spec fires `pause` right before `ended` when a track finishes
        // naturally. Don't broadcast a "paused" state for that — it's a
        // false signal to the OS/car media session that can cause it to
        // treat playback as stopped between chapters.
        if (this.autoAdvance && el.ended) return;
        // OS / Bluetooth / Chrome may pause the new chapter in the gap
        // between chapters. Undo that unless the user actually paused.
        if (this.transitioning && !this.userPaused) {
          if (el.paused && !el.ended && el.currentSrc) {
            el.play().catch(() => {});
          }
          return;
        }
        this.isPlaying$.next(false);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      });

      el.addEventListener('ended', () => this.handleTrackEnded(el));

      // Streamed MP3s (online, not yet in IndexedDB) sometimes never fire
      // `ended` and just stall at the last buffer. Treat that as finished.
      const maybeStuckAtEnd = () => {
        if (el !== this.activeAudio) return;
        if (!this.autoAdvance || this.transitioning || this.advancing) return;
        const { currentTime, duration } = el;
        if (!duration || !isFinite(duration)) return;
        if (currentTime < duration - 0.35) return;
        this.handleTrackEnded(el);
      };
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
      // Phone speaker / notification shade: Android often invokes `pause`
      // when it sees a chapter end, even though we're already starting the
      // next one. Car Bluetooth usually does not, which is why the same
      // playlist can work in the car and then stall on the phone.
      if (this.transitioning && !this.userPaused) {
        this.keepPlaybackStatePlaying();
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
        if (this.transitioning && !this.userPaused) {
          this.keepPlaybackStatePlaying();
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
    el.volume = 1;
    el.muted = false;
    el.setAttribute('playsinline', 'true');
  }

  private keepPlaybackStatePlaying() {
    this.isPlaying$.next(true);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  }

  private beginTransition() {
    this.transitioning = true;
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
    // Hold the transition window a bit past actual start so a late OS pause
    // (common 50–400ms after `ended` on phone speaker) is still ignored.
    this.transitioning = true;
    if (this.transitionTimer != null) clearTimeout(this.transitionTimer);
    this.transitionTimer = setTimeout(() => this.endTransition(true), 700);
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
    el.muted = false;
    el.volume = 1;
    const blob = this.blobUrlByEl.get(el);
    if (blob) {
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
    return track.url;
  }

  /**
   * While the current chapter is still playing, start the next one muted on
   * the other element. Mobile browsers treat a gap after `ended` as a new
   * autoplay (and block it). Playing the next source *before* the current
   * one stops is the only way to keep the session continuous.
   */
  private maybePrimeNext(el: HTMLAudioElement) {
    if (!this.autoAdvance || this.userPaused || this.advancing || this.nextPrimed) return;
    if (el.paused || el.ended) return;
    if (this.playlist.length <= this.index + 1) return;

    const nextTrack = this.playlist[this.index + 1];
    if (!this.isInactiveReadyFor(nextTrack)) return;

    const remaining = el.duration - el.currentTime;
    if (!isFinite(remaining) || remaining > PRIME_REMAINING_S || remaining < 0) return;

    this.nextPrimed = true;
    this.inactiveAudio.muted = true;
    this.inactiveAudio.volume = 0;
    try {
      this.inactiveAudio.currentTime = 0;
    } catch {
      // Will restart from 0 on take-over if seeking isn't allowed yet.
    }
    this.inactiveAudio.play()
      .then(() => {
        console.log('Primed next chapter (muted, still playing current):', nextTrack.title);
      })
      .catch(err => {
        console.warn('Prime next failed:', err?.name, err?.message);
        this.nextPrimed = false;
        this.inactiveAudio.muted = false;
        this.inactiveAudio.volume = 1;
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
    this.beginTransition();
    this.index += 1;
    this.startNextTrack(this.playlist[this.index]);

    if (endedTrack) {
      this.trackEndedSource.next(endedTrack);
      this.analytics.chapterCompleted(endedTrack.book, endedTrack.chapter);
    }
  }

  /**
   * Keep audio output continuous across chapters.
   *
   * Mobile browsers block `play()` if output has already stopped. So:
   *  1. If we already started the next chapter muted near the end of the
   *     current one, unmute it and swap — output never stopped.
   *  2. Else if the next source is fully buffered on the other element,
   *     `play()` that element first (still inside `ended`), then swap.
   *  3. Last resort: set src on the element that just ended and `play()`
   *     immediately. That has a load gap, so it can still be blocked.
   */
  private startNextTrack(track: Track) {
    const preloaded = this.preloaded?.track === track ? this.preloaded : null;

    if (this.nextPrimed && this.inactiveAudio.src) {
      this.takeOverPrimed(track);
      return;
    }

    if (preloaded && this.isInactiveReadyFor(track)) {
      this.preloadGeneration++;
      this.nextPrimed = false;
      try {
        this.inactiveAudio.currentTime = 0;
      } catch {
        // Not seekable yet — play() will start from the beginning anyway.
      }
      this.inactiveAudio.muted = false;
      this.inactiveAudio.volume = 1;
      // play() first, while this is still a continuation of the ended turn.
      const playPromise = this.inactiveAudio.play();
      this.preloaded = null;
      this.adoptInactiveAsActive();
      playPromise
        .then(() => {
          console.log('Seamless next track started:', track.title);
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

  private takeOverPrimed(track: Track) {
    this.preloadGeneration++;
    this.nextPrimed = false;
    this.preloaded = null;
    try {
      this.inactiveAudio.currentTime = 0;
    } catch {
      // Keep going from wherever the muted prime reached (~0.4s in).
    }
    this.inactiveAudio.muted = false;
    this.inactiveAudio.volume = 1;
    if (this.inactiveAudio.paused) {
      this.inactiveAudio.play().catch(err => {
        console.warn('Primed take-over play() failed:', err?.name, err?.message);
        this.playOnActiveNow(track, track.url);
      });
    }
    this.adoptInactiveAsActive();
    this.onStarted(track);
    void this.preloadNextIfPossible();
    console.log('Took over primed next chapter:', track.title);
  }

  private isInactiveReadyFor(track: Track): boolean {
    if (this.preloaded?.track !== track) return false;
    if (!this.inactiveAudio.src) return false;
    // HAVE_FUTURE_DATA (3): enough decoded audio that play() starts immediately.
    if (this.inactiveAudio.readyState < 3) return false;
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
    this.clearElement(this.inactiveAudio, !transferringBlob);

    playPromise
      .then(() => {
        console.log('Next track started (same element):', track.title);
        this.onStarted(track);
        void this.preloadNextIfPossible();
      })
      .catch(async err => {
        console.warn('Same-element next failed, trying cached blob:', err?.name, err?.message);
        try {
          await this.activeAudio.play();
          this.onStarted(track);
          void this.preloadNextIfPossible();
          return;
        } catch {
          // First retry of the same src failed; try a blob if we were streaming.
        }
        try {
          const blobUrl = await this.resolvePlayUrl(track);
          if (blobUrl === url) throw err;
          this.setAudioSource(this.activeAudio, blobUrl);
          await this.activeAudio.play();
          this.onStarted(track);
          void this.preloadNextIfPossible();
        } catch (err2) {
          console.error('Failed to start next track', err2);
          this.clearTransition(false);
          this.isPlaying$.next(false);
        }
      });
  }

  private adoptInactiveAsActive() {
    const oldActive = this.activeAudio;
    this.activeAudio = this.inactiveAudio;
    this.inactiveAudio = oldActive;
    this.activeAudio.muted = false;
    this.activeAudio.volume = 1;
    this.clearElement(oldActive);
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
    // startNextTrack's same-element fallback stream it directly instead.
    if (!url.startsWith('blob:')) return;

    this.setAudioSource(this.inactiveAudio, url);
    this.inactiveAudio.load();
    this.preloaded = { track: nextTrack, url, ready: false };
    const markReady = () => {
      if (this.preloaded?.track === nextTrack) this.preloaded.ready = true;
    };
    this.inactiveAudio.addEventListener('canplaythrough', markReady, { once: true });
    this.inactiveAudio.addEventListener('canplay', markReady, { once: true });
    if (this.inactiveAudio.readyState >= 3) markReady();
    console.log('Preloading next:', nextTrack.title, '(blob)');
  }
}
