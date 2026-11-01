import { Subject } from 'rxjs';

import { Track } from '../models/track';
import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';

const plugin = (() => {
  let listener: ((e: { status: unknown }) => void) | null = null;
  // Same values as the plugin's RmxAudioStatusMessage enum.
  const RmxAudioStatusMessage = {
    RMXSTATUS_ERROR: 5, RMXSTATUS_CANPLAY: 11, RMXSTATUS_LOADED: 15, RMXSTATUS_PLAYING: 30,
    RMXSTATUS_PAUSE: 35, RMXSTATUS_PLAYBACK_POSITION: 40, RMXSTATUS_SEEK: 45, RMXSTATUS_COMPLETED: 50,
    RMXSTATUS_DURATION: 55, RMX_STATUS_SKIP_FORWARD: 90, RMXSTATUS_TRACK_CHANGED: 100,
    RMXSTATUS_PLAYLIST_COMPLETED: 105,
  };
  return {
    RmxAudioStatusMessage,
    emit: (status: unknown) => listener?.({ status }),
    Playlist: {
      setOptions: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn(async (_: string, fn: (e: { status: unknown }) => void) => {
        listener = fn;
        return { remove: vi.fn() };
      }),
      setPlaylistItems: vi.fn().mockResolvedValue(undefined),
      playTrackByIndex: vi.fn().mockResolvedValue(undefined),
      replaceItem: vi.fn().mockResolvedValue(undefined),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      skipForward: vi.fn().mockResolvedValue(undefined),
      skipBack: vi.fn().mockResolvedValue(undefined),
      seekTo: vi.fn().mockResolvedValue(undefined),
      clearAllItems: vi.fn().mockResolvedValue(undefined),
    },
  };
})();

const { RmxAudioStatusMessage } = plugin;

import { NativeAudioEngine } from './native-audio-engine';

function track(id: string, chapter: number): Track {
  return {
    id, book: 'João', chapter, title: `João ${chapter}`, fileName: `${id}.mp3`,
    url: `https://cdn.example/${id}.mp3`, status: 'pending',
  };
}

describe('NativeAudioEngine', () => {
  let engine: NativeAudioEngine;
  let local: Record<string, string>;
  let downloaded: Subject<Track>;
  let analytics: { chapterCompleted: ReturnType<typeof vi.fn> };

  function create(platform: 'android' | 'ios') {
    const downloader = {
      localUrl: vi.fn(async (t: Track) => local[t.id] ?? null),
      trackDownloaded$: downloaded,
    };
    return new NativeAudioEngine(
      downloader as unknown as AudioDownloaderService,
      analytics as unknown as AnalyticsService,
      platform,
      () => Promise.resolve('file:///data/artwork-512.png'),
      plugin.Playlist as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    local = { j1: 'file:///data/audios/j1.mp3' };
    downloaded = new Subject<Track>();
    analytics = { chapterCompleted: vi.fn() };
    engine = create('android');
  });

  afterEach(() => vi.useRealTimers());

  async function start(tracks = [track('j1', 1), track('j2', 2), track('j3', 3)], at = 0) {
    await engine.playPlaylist(tracks, at);
    const items = plugin.Playlist.setPlaylistItems.mock.calls[0][0].items;
    return { tracks, items };
  }

  it('queues the whole playlist natively, preferring local files', async () => {
    const { items } = await start();
    expect(items.map((i: { assetUrl: string }) => i.assetUrl)).toEqual([
      'file:///data/audios/j1.mp3',
      'https://cdn.example/j2.mp3',
      'https://cdn.example/j3.mp3',
    ]);
    expect(new Set(items.map((i: { trackId: string }) => i.trackId)).size).toBe(3);
    expect(items[0].albumArt).toBe('file:///data/artwork-512.png');
    expect(plugin.Playlist.playTrackByIndex).toHaveBeenCalledWith({ index: 0 });
  });

  it('keeps duplicate chapters as distinct queue entries', async () => {
    const { items } = await start([track('ps23', 23), track('ps23', 23)]);
    expect(items[0].trackId).not.toBe(items[1].trackId);
  });

  it('follows native track changes and play state', async () => {
    const { items, tracks } = await start();
    plugin.emit({
      msgType: RmxAudioStatusMessage.RMXSTATUS_TRACK_CHANGED,
      trackId: items[1].trackId,
      value: { currentItem: items[1], currentIndex: 1, hasNext: true, hasPrevious: true },
    });
    plugin.emit({ msgType: RmxAudioStatusMessage.RMXSTATUS_PLAYING, trackId: items[1].trackId, value: { currentPosition: 3, duration: 200 } });

    expect(engine.currentTrack$.value).toBe(tracks[1]);
    expect(engine.isPlaying$.value).toBe(true);
    expect(engine.timeUpdate$.value).toEqual({ currentTime: 3, duration: 200 });
    expect(engine.hasNext()).toBe(true);
    expect(engine.hasPrevious()).toBe(true);

    plugin.emit({ msgType: RmxAudioStatusMessage.RMXSTATUS_PAUSE, trackId: items[1].trackId, value: { currentPosition: 4, duration: 200 } });
    expect(engine.isPlaying$.value).toBe(false);
  });

  it('reports a chapter as ended only when it plays to completion', async () => {
    const { items, tracks } = await start();
    const ended: (Track | null)[] = [];
    engine.trackEnded$.subscribe(t => ended.push(t));

    plugin.emit({ msgType: RmxAudioStatusMessage.RMX_STATUS_SKIP_FORWARD, trackId: items[0].trackId, value: {} });
    expect(ended.filter(Boolean)).toEqual([]);

    plugin.emit({ msgType: RmxAudioStatusMessage.RMXSTATUS_COMPLETED, trackId: items[0].trackId, value: {} });
    expect(ended.filter(Boolean)).toEqual([tracks[0]]);
    expect(analytics.chapterCompleted).toHaveBeenCalledWith('João', 1);
  });

  it('ignores events from a previous playlist', async () => {
    const first = await start();
    plugin.Playlist.setPlaylistItems.mockClear();
    const second = await start([track('a1', 1), track('a2', 2)]);
    plugin.emit({
      msgType: RmxAudioStatusMessage.RMXSTATUS_TRACK_CHANGED,
      trackId: first.items[2].trackId,
      value: { currentItem: first.items[2], hasNext: false, hasPrevious: true },
    });
    expect(engine.currentTrack$.value).toBe(second.tracks[0]);
  });

  it('swaps a queued stream for the local file once it downloads (Android: right away)', async () => {
    const { tracks } = await start();
    local['j3'] = 'file:///data/audios/j3.mp3';
    downloaded.next(tracks[2]);
    await vi.waitFor(() => expect(plugin.Playlist.replaceItem).toHaveBeenCalled());
    const call = plugin.Playlist.replaceItem.mock.calls[0][0];
    expect(call.index).toBe(2);
    expect(call.item.assetUrl).toBe('file:///data/audios/j3.mp3');
  });

  it('batches swaps on iOS until downloads go quiet', async () => {
    engine = create('ios');
    const { tracks } = await start();
    vi.useFakeTimers();
    local['j2'] = 'file:///data/audios/j2.mp3';
    local['j3'] = 'file:///data/audios/j3.mp3';
    downloaded.next(tracks[1]);
    await vi.advanceTimersByTimeAsync(2000);
    downloaded.next(tracks[2]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(plugin.Playlist.replaceItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2500);
    expect(plugin.Playlist.replaceItem.mock.calls.map(c => c[0].index)).toEqual([1, 2]);
  });

  it('never swaps the item that is currently playing', async () => {
    const { tracks } = await start();
    local['j1'] = 'file:///data/audios/j1.mp3';
    downloaded.next(tracks[0]);
    await new Promise(r => setTimeout(r, 0));
    expect(plugin.Playlist.replaceItem).not.toHaveBeenCalled();
  });

  it('maps player controls onto the plugin', async () => {
    const { items } = await start();
    plugin.emit({
      msgType: RmxAudioStatusMessage.RMXSTATUS_TRACK_CHANGED,
      trackId: items[0].trackId,
      value: { currentItem: items[0], hasNext: true, hasPrevious: false },
    });
    engine.next();
    engine.previous(); // no previous at index 0 → ignored
    engine.seekTo(42);
    await new Promise(r => setTimeout(r, 0));
    expect(plugin.Playlist.skipForward).toHaveBeenCalledTimes(1);
    expect(plugin.Playlist.skipBack).not.toHaveBeenCalled();
    expect(plugin.Playlist.seekTo).toHaveBeenCalledWith({ position: 42 });
  });
});
