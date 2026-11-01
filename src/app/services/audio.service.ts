import { Injectable } from '@angular/core';

import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';
import { AudioEngine } from './audio-engine';
import { WebAudioEngine } from './web-audio-engine';
import { NativeAudioEngine } from './native-audio-engine';
import { Track } from '../models/track';
import { isNativeApp } from '../utils/platform.util';

/**
 * App-wide player. Same API everywhere; the backend is chosen once:
 * the OS media player in the Android/iOS apps, HTMLAudioElement on the web.
 */
@Injectable({ providedIn: 'root' })
export class AudioService implements AudioEngine {
  private readonly engine: AudioEngine;

  constructor(downloader: AudioDownloaderService, analytics: AnalyticsService) {
    this.engine = isNativeApp()
      ? new NativeAudioEngine(downloader, analytics)
      : new WebAudioEngine(downloader, analytics);
  }

  get currentTrack$() { return this.engine.currentTrack$; }
  get isPlaying$() { return this.engine.isPlaying$; }
  get timeUpdate$() { return this.engine.timeUpdate$; }
  get trackEnded$() { return this.engine.trackEnded$; }

  playTrack(track: Track, playlist?: Track[], startIndex = 0) {
    return this.engine.playTrack(track, playlist, startIndex);
  }
  playPlaylist(tracks: Track[], startIndex = 0) { return this.engine.playPlaylist(tracks, startIndex); }
  setPlaylist(tracks: Track[], startIndex = 0) { this.engine.setPlaylist(tracks, startIndex); }

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
