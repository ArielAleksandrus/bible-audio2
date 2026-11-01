import { BehaviorSubject, Observable } from 'rxjs';
import { Track } from '../models/track';

/**
 * What the UI (mini player, Home, Plans) needs from a playback backend.
 * AudioService picks one implementation at startup:
 *
 * - WebAudioEngine: HTMLAudioElement + Media Session (PWA/browser).
 * - NativeAudioEngine: the OS media player via @dwbn/capacitor-plugin-playlist
 *   (Android Media3 foreground service / iOS AVQueuePlayer).
 */
export interface AudioEngine {
  readonly currentTrack$: BehaviorSubject<Track | null>;
  readonly isPlaying$: BehaviorSubject<boolean>;
  readonly timeUpdate$: BehaviorSubject<{ currentTime: number; duration: number }>;
  /** Emits a chapter that played through to its end (drives plan progress). */
  readonly trackEnded$: Observable<Track | null>;

  playTrack(track: Track, playlist?: Track[], startIndex?: number): Promise<void>;
  playPlaylist(tracks: Track[], startIndex?: number): Promise<void>;
  setPlaylist(tracks: Track[], startIndex?: number): void;

  play(): void;
  pause(): void;
  toggle(): void;
  stop(): void;
  seekTo(seconds: number): void;
  skip(seconds: number): void;
  next(): void;
  previous(): void;
  hasNext(): boolean;
  hasPrevious(): boolean;
}
