import { Injectable, inject } from '@angular/core';

import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';
import { AudioEngine } from './audio-engine';
import { WebAudioEngine } from './web-audio-engine';
import { NativeAudioEngine } from './native-audio-engine';
import { Track } from '../models/track';
import { isNativeApp } from '../utils/platform.util';
import { PreferencesService } from './preferences.service';
import { retargetTracks } from './bible.service';
import { catalogEntry } from '../data/bible-catalog';

/**
 * App-wide player. Same API everywhere; the backend is chosen once:
 * the OS media player in the Android/iOS apps, HTMLAudioElement on the web.
 */
@Injectable({ providedIn: 'root' })
export class AudioService implements AudioEngine {
  private readonly engine: AudioEngine;
  private readonly prefs = inject(PreferencesService);
  /** The playlist last handed to the engine, to rebuild it when the narrator changes. */
  private playlist: Track[] = [];

  constructor(downloader: AudioDownloaderService, analytics: AnalyticsService) {
    this.engine = isNativeApp()
      ? new NativeAudioEngine(downloader, analytics)
      : new WebAudioEngine(downloader, analytics);

    // BehaviorSubject: also applies the saved speed right at startup.
    this.prefs.playbackRate$.subscribe(rate => this.engine.setPlaybackRate(rate));
  }

  get currentTrack$() { return this.engine.currentTrack$; }
  get isPlaying$() { return this.engine.isPlaying$; }
  get timeUpdate$() { return this.engine.timeUpdate$; }
  get trackEnded$() { return this.engine.trackEnded$; }

  playTrack(track: Track, playlist?: Track[], startIndex = 0) {
    if (playlist) this.playlist = playlist;
    return this.engine.playTrack(track, playlist, startIndex);
  }
  playPlaylist(tracks: Track[], startIndex = 0) {
    this.playlist = tracks;
    return this.engine.playPlaylist(tracks, startIndex);
  }
  loadPlaylist(tracks: Track[], startIndex = 0) {
    this.playlist = tracks;
    return this.engine.loadPlaylist(tracks, startIndex);
  }
  setPlaylist(tracks: Track[], startIndex = 0) {
    this.playlist = tracks;
    this.engine.setPlaylist(tracks, startIndex);
  }

  /**
   * What selecting a chapter or a plan does: play it, or — with "play on
   * selection" turned off — only put it in the player, ready for the user's
   * own tap on play.
   */
  openPlaylist(tracks: Track[], startIndex = 0) {
    return this.prefs.autoplay ? this.playPlaylist(tracks, startIndex) : this.loadPlaylist(tracks, startIndex);
  }

  setPlaybackRate(rate: number) { this.engine.setPlaybackRate(rate); }

  /**
   * Switch the voice of the version being listened to. The chapter in the
   * player restarts from its beginning in the new voice (two narrations of
   * a chapter don't line up second for second); it keeps playing if it was
   * playing, and stays paused if it wasn't.
   */
  async changeNarrator(narratorId: string): Promise<void> {
    const current = this.currentTrack$.value;
    const entry = current?.lang && current.version ? catalogEntry(current.lang, current.version) : undefined;
    if (!current || !entry) return;
    this.prefs.setNarrator(entry, narratorId);

    const index = Math.max(0, this.playlist.findIndex(t => t.id === current.id));
    const wasPlaying = this.isPlaying$.value;
    const tracks = retargetTracks(this.playlist.length ? this.playlist : [current], this.prefs.narratorFor(entry));
    await (wasPlaying ? this.playPlaylist(tracks, index) : this.loadPlaylist(tracks, index));
  }

  play() { this.engine.play(); }
  pause() { this.engine.pause(); }
  toggle() { this.engine.toggle(); }
  stop() { this.engine.stop(); }
  seekTo(seconds: number) { this.engine.seekTo(seconds); }
  skip(seconds: number) { this.engine.skip(seconds); }
  next() { this.engine.next(); }
  previous() { this.engine.previous(); }
  hasNext() { return this.engine.hasNext(); }
  hasPrevious() { return this.engine.hasPrevious(); }
}
