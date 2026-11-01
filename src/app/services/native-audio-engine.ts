import { BehaviorSubject, Subscription } from 'rxjs';
import {
  Playlist as PlaylistPlugin,
  RmxAudioStatusMessage,
  type AudioTrack,
  type OnStatusCallbackData,
  type OnStatusCallbackUpdateData,
  type OnStatusTrackChangedData,
  type OnStatusErrorCallbackData,
} from '@dwbn/capacitor-plugin-playlist';

import { AudioEngine } from './audio-engine';
import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';
import { Track } from '../models/track';
import { nativePlatform, nativeSafeUrl } from '../utils/platform.util';
import { artworkUri } from '../storage/artwork';

const ARTIST = 'Bíblia Narrada';

type PlaylistApi = Pick<typeof PlaylistPlugin,
  'setOptions' | 'initialize' | 'addListener' | 'setPlaylistItems' | 'playTrackByIndex' | 'replaceItem' |
  'play' | 'pause' | 'skipForward' | 'skipBack' | 'seekTo' | 'clearAllItems'>;

/**
 * Native (Android/iOS) playback engine.
 *
 * The whole playlist is handed to the OS media player once:
 * - Android: Media3 ExoPlayer inside a `mediaPlayback` foreground service,
 *   with a MediaSession (notification, lock screen, Bluetooth/car buttons,
 *   Android Auto).
 * - iOS: AVQueuePlayer with `UIBackgroundModes: audio`, Now Playing info and
 *   MPRemoteCommandCenter (lock screen, Control Center, CarPlay/Bluetooth).
 *
 * Track-to-track advance happens natively, so none of WebAudioEngine's
 * locked-screen workarounds are needed: no second element, no muted priming,
 * no early hand-off, no "resume a spurious pause from inside the event".
 * This class only translates the plugin's status stream into the same
 * observables the UI already consumes.
 */
export class NativeAudioEngine implements AudioEngine {
  readonly currentTrack$ = new BehaviorSubject<Track | null>(null);
  readonly isPlaying$ = new BehaviorSubject<boolean>(false);
  readonly timeUpdate$ = new BehaviorSubject<{ currentTime: number; duration: number }>({
    currentTime: 0,
    duration: 0,
  });
  private readonly trackEndedSource = new BehaviorSubject<Track | null>(null);
  readonly trackEnded$ = this.trackEndedSource.asObservable();

  private playlist: Track[] = [];
  private index = 0;
  private hasNextFlag = false;
  private hasPreviousFlag = false;
  /** Bumped on every new playlist so stale status events / replacements are ignored. */
  private generation = 0;
  private ready: Promise<void>;
  private downloadSub: Subscription;

  constructor(
    private downloader: AudioDownloaderService,
    private analytics: AnalyticsService,
    private platform: 'android' | 'ios' | 'web' = nativePlatform(),
    private artwork: () => Promise<string | null> = () => artworkUri(platform),
    private readonly Playlist: PlaylistApi = PlaylistPlugin,
  ) {
    this.ready = this.init().catch(err => console.error('NativeAudioEngine: init failed', err));

    // A chapter queued while still on the network gets swapped for its local
    // file as soon as it finishes downloading, so a playlist started online
    // keeps playing after the connection drops (car, airplane mode…).
    this.downloadSub = this.downloader.trackDownloaded$.subscribe(track => this.useLocalFileFor(track));
  }

  private async init(): Promise<void> {
    await this.Playlist.setOptions({
      verbose: false,
      resetStreamOnPause: false,
      options: { icon: 'ic_stat_notification' },
    });
    await this.Playlist.initialize();
    await this.Playlist.addListener('status', ({ status }) => this.onStatus(status));
  }

  // === PLAYBACK ===

  async playTrack(track: Track, playlist?: Track[], startIndex = 0): Promise<void> {
    if (playlist) {
      await this.playPlaylist(playlist, startIndex);
      return;
    }
    const idx = this.playlist.findIndex(t => t.id === track.id);
    if (idx >= 0) {
      await this.ready;
      await this.Playlist.playTrackByIndex({ index: idx });
    } else {
      await this.playPlaylist([track], 0);
    }
  }

  async playPlaylist(tracks: Track[], startIndex = 0): Promise<void> {
    if (tracks.length === 0) return;
    await this.ready;
    const gen = ++this.generation;
    this.playlist = tracks;
    this.index = startIndex;
    this.updateNavFlags();
    this.currentTrack$.next(tracks[startIndex] ?? null);
    this.timeUpdate$.next({ currentTime: 0, duration: 0 });

    const items = await Promise.all(tracks.map((t, i) => this.toNativeItem(t, i, gen)));
    if (gen !== this.generation) return;

    await this.Playlist.setPlaylistItems({
      items,
      options: { startPaused: true, retainPosition: false },
    });
    await this.Playlist.playTrackByIndex({ index: startIndex });
  }

  setPlaylist(tracks: Track[], startIndex = 0): void {
    this.playlist = tracks;
    this.index = startIndex;
    this.updateNavFlags();
  }

  play(): void {
    void this.ready.then(() => this.Playlist.play());
  }

  pause(): void {
    void this.ready.then(() => this.Playlist.pause());
  }

  toggle(): void {
    if (this.isPlaying$.value) this.pause();
    else this.play();
  }

  stop(): void {
    this.generation++;
    this.playlist = [];
    this.index = 0;
    this.updateNavFlags();
    this.isPlaying$.next(false);
    void this.ready.then(async () => {
      await this.Playlist.pause();
      await this.Playlist.clearAllItems();
    });
  }

  seekTo(seconds: number): void {
    this.timeUpdate$.next({ currentTime: Math.floor(seconds), duration: this.timeUpdate$.value.duration });
    void this.ready.then(() => this.Playlist.seekTo({ position: seconds }));
  }

  skip(seconds: number): void {
    const { currentTime, duration } = this.timeUpdate$.value;
    const target = Math.max(0, Math.min(currentTime + seconds, duration || currentTime + seconds));
    this.seekTo(target);
  }

  next(): void {
    if (!this.hasNext()) return;
    void this.ready.then(() => this.Playlist.skipForward());
  }

  previous(): void {
    if (!this.hasPrevious()) return;
    void this.ready.then(() => this.Playlist.skipBack());
  }

  hasNext(): boolean {
    return this.hasNextFlag;
  }

  hasPrevious(): boolean {
    return this.hasPreviousFlag;
  }

  // === STATUS STREAM ===

  private onStatus(status: OnStatusCallbackData): void {
    switch (status.msgType) {
      case RmxAudioStatusMessage.RMXSTATUS_TRACK_CHANGED: {
        const data = status.value as OnStatusTrackChangedData;
        const idx = this.indexFromTrackId(data?.currentItem?.trackId ?? status.trackId);
        if (idx == null) return;
        this.index = idx;
        this.hasNextFlag = !!data.hasNext;
        this.hasPreviousFlag = !!data.hasPrevious;
        this.currentTrack$.next(this.playlist[idx] ?? null);
        this.timeUpdate$.next({ currentTime: 0, duration: 0 });
        return;
      }

      case RmxAudioStatusMessage.RMXSTATUS_PLAYING:
        this.isPlaying$.next(true);
        this.updateTime(status.value as OnStatusCallbackUpdateData);
        return;

      case RmxAudioStatusMessage.RMXSTATUS_PAUSE:
        this.isPlaying$.next(false);
        this.updateTime(status.value as OnStatusCallbackUpdateData);
        return;

      case RmxAudioStatusMessage.RMXSTATUS_PLAYBACK_POSITION:
      case RmxAudioStatusMessage.RMXSTATUS_DURATION:
      case RmxAudioStatusMessage.RMXSTATUS_SEEK:
      case RmxAudioStatusMessage.RMXSTATUS_CANPLAY:
      case RmxAudioStatusMessage.RMXSTATUS_LOADED: {
        const data = status.value as OnStatusCallbackUpdateData;
        if (this.indexFromTrackId(status.trackId) !== this.index) return;
        this.updateTime(data);
        if (data?.status === 'playing' && !this.isPlaying$.value) this.isPlaying$.next(true);
        return;
      }

      case RmxAudioStatusMessage.RMXSTATUS_COMPLETED: {
        // Fires only when a chapter plays through to its end (not on a
        // manual skip) — same contract as WebAudioEngine's trackEnded$.
        const idx = this.indexFromTrackId(status.trackId);
        const ended = idx != null ? this.playlist[idx] : null;
        if (ended) {
          this.trackEndedSource.next(ended);
          this.analytics.chapterCompleted(ended.book, ended.chapter);
        }
        return;
      }

      case RmxAudioStatusMessage.RMXSTATUS_PLAYLIST_COMPLETED:
        this.isPlaying$.next(false);
        this.hasNextFlag = false;
        return;

      case RmxAudioStatusMessage.RMXSTATUS_ERROR: {
        const err = status.value as OnStatusErrorCallbackData;
        console.error('NativeAudioEngine: playback error', status.trackId, err?.code, err?.message);
        return;
      }
    }
  }

  private updateTime(data: OnStatusCallbackUpdateData | undefined): void {
    if (!data) return;
    const currentTime = Math.floor(data.currentPosition || 0);
    const duration = Math.floor(data.duration || 0) || this.timeUpdate$.value.duration;
    this.timeUpdate$.next({ currentTime, duration });
  }

  private updateNavFlags(): void {
    this.hasNextFlag = this.playlist.length > 1 && this.index < this.playlist.length - 1;
    this.hasPreviousFlag = this.playlist.length > 1 && this.index > 0;
  }

  // === ITEMS ===

  /**
   * Native trackIds must be unique within the queue (the Android side drops
   * duplicate ids on add), but a reading plan can list the same chapter on
   * two different days — so the queue position is baked into the id, along
   * with the playlist generation so late events from a replaced playlist
   * can't be mistaken for the current one.
   */
  private nativeId(gen: number, index: number, track: Track): string {
    return `${gen}:${index}:${track.id}`;
  }

  private indexFromTrackId(trackId: string | undefined): number | null {
    if (!trackId) return null;
    const [gen, idx] = trackId.split(':');
    if (Number(gen) !== this.generation) return null;
    const n = Number(idx);
    return Number.isInteger(n) && n >= 0 && n < this.playlist.length ? n : null;
  }

  private async toNativeItem(track: Track, index: number, gen: number): Promise<AudioTrack> {
    const local = await this.downloader.localUrl(track).catch(() => null);
    return {
      trackId: this.nativeId(gen, index, track),
      assetUrl: local || nativeSafeUrl(track.url),
      isStream: false,
      title: track.title,
      artist: ARTIST,
      album: track.book,
      albumArt: (await this.artwork()) ?? undefined,
    };
  }

  /**
   * Android (Media3) swaps a queued, non-current item in place without
   * touching the one that's playing, so it's done per chapter right away.
   * iOS's AVQueuePlayer has no in-place swap — the plugin rebuilds the whole
   * queue and seeks back, which can be a short audible hiccup — so there the
   * swaps are batched until downloads have been quiet for a few seconds (bulk
   * downloads finish far faster than a chapter plays, so this is usually one
   * rebuild early in the first chapter).
   */
  private pendingLocal = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private useLocalFileFor(track: Track): void {
    if (!this.playlist.some(t => t.id === track.id)) return;
    this.pendingLocal.add(track.id);
    if (this.platform === 'android') {
      void this.flushLocalSwaps();
      return;
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushLocalSwaps();
    }, 4000);
  }

  private async flushLocalSwaps(): Promise<void> {
    const ids = new Set(this.pendingLocal);
    this.pendingLocal.clear();
    const gen = this.generation;
    await this.ready;
    for (let i = 0; i < this.playlist.length; i++) {
      if (gen !== this.generation) return;
      const track = this.playlist[i];
      if (i === this.index || !ids.has(track.id)) continue;
      try {
        const item = await this.toNativeItem(track, i, gen);
        if (item.assetUrl === nativeSafeUrl(track.url)) continue; // not actually local yet
        await this.Playlist.replaceItem({ index: i, item });
      } catch (err) {
        console.warn('NativeAudioEngine: could not swap in local file for', track.id, err);
      }
    }
  }
}
