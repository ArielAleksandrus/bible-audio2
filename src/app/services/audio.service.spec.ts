import { AudioService } from './audio.service';
import { AudioDownloaderService } from './audio-downloader.service';
import { AnalyticsService } from './analytics.service';
import { Track } from '../models/track';

class FakeAudio extends EventTarget {
  preload = 'auto';
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 120;
  readyState = 0;
  currentSrc = '';
  volume = 1;
  muted = false;
  private _src = '';

  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    this.currentSrc = value;
    this.ended = false;
  }

  setAttribute(name: string, value: string) {
    (this as unknown as Record<string, string>)[name] = value;
  }
  removeAttribute(name: string) {
    if (name === 'src') {
      this._src = '';
      this.currentSrc = '';
    }
  }
  load() {
    this.ended = false;
  }
  play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
}

function track(id: string, chapter: number): Track {
  return {
    id,
    book: 'John',
    chapter,
    title: `John ${chapter}`,
    fileName: `${id}.mp3`,
    url: `https://example.com/${id}.mp3`,
    status: 'pending',
  };
}

function finish(el: FakeAudio) {
  el.currentTime = el.duration;
  el.ended = true;
  el.paused = true;
  el.dispatchEvent(new Event('pause'));
  el.dispatchEvent(new Event('ended'));
}

describe('AudioService auto-advance', () => {
  let instances: FakeAudio[];
  let mediaHandlers: Record<string, Function | null>;
  let service: AudioService;
  let downloader: { download: ReturnType<typeof vi.fn> };
  let analytics: { chapterCompleted: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    instances = [];
    mediaHandlers = {};

    vi.stubGlobal(
      'Audio',
      class extends FakeAudio {
        constructor() {
          super();
          instances.push(this);
        }
      },
    );

    vi.stubGlobal('MediaMetadata', class {
      constructor(public data: unknown) {}
    });

    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        playbackState: 'none',
        metadata: null,
        setActionHandler: (action: string, handler: Function | null) => {
          mediaHandlers[action] = handler;
        },
        setPositionState: () => {},
      },
    });

    downloader = { download: vi.fn().mockResolvedValue(undefined) };
    analytics = { chapterCompleted: vi.fn() };
    service = new AudioService(
      downloader as unknown as AudioDownloaderService,
      analytics as unknown as AnalyticsService,
    );
  });

  afterEach(() => {
    service.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function startTwoChapterPlaylist() {
    const tracks = [track('j1', 1), track('j2', 2)];
    await service.playPlaylist(tracks, 0);
    return tracks;
  }

  it('starts the next chapter when the current one ends', async () => {
    await startTwoChapterPlaylist();
    expect(service.currentTrack$.value?.id).toBe('j1');
    expect(service.isPlaying$.value).toBe(true);

    finish(instances[0]);
    await Promise.resolve();
    await Promise.resolve();

    expect(analytics.chapterCompleted).toHaveBeenCalledWith('John', 1);
    expect(service.currentTrack$.value?.id).toBe('j2');
    expect(service.isPlaying$.value).toBe(true);
    expect(instances[0].paused).toBe(false);
    expect(instances[0].src).toContain('j2.mp3');
  });

  it('keeps playing the next chapter when the OS fires pause at the chapter boundary', async () => {
    await startTwoChapterPlaylist();

    finish(instances[0]);
    // Simulate Android invoking Media Session pause because it saw the
    // previous element stop — this is what happens on the phone speaker
    // and typically does not happen over car Bluetooth.
    mediaHandlers['pause']?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.currentTrack$.value?.id).toBe('j2');
    expect(service.isPlaying$.value).toBe(true);
    expect(instances[0].paused).toBe(false);
    expect(navigator.mediaSession.playbackState).toBe('playing');
  });

  it('still honors an in-app pause during the transition window', async () => {
    await startTwoChapterPlaylist();

    finish(instances[0]);
    service.pause();
    await Promise.resolve();

    expect(instances[0].paused).toBe(true);
    expect(service.isPlaying$.value).toBe(false);
  });

  it('honors a media-session pause after the transition hold', async () => {
    vi.useFakeTimers();
    await startTwoChapterPlaylist();

    finish(instances[0]);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.currentTrack$.value?.id).toBe('j2');

    await vi.advanceTimersByTimeAsync(800);
    mediaHandlers['pause']?.();

    expect(instances[0].paused).toBe(true);
    expect(service.isPlaying$.value).toBe(false);
  });

  it('does not auto-advance past the last chapter', async () => {
    const tracks = [track('j1', 1)];
    await service.playPlaylist(tracks, 0);

    finish(instances[0]);
    await Promise.resolve();

    expect(service.currentTrack$.value?.id).toBe('j1');
    expect(service.isPlaying$.value).toBe(false);
    expect(service.hasNext()).toBe(false);
  });

  it('does not skip two chapters when ended and nexttrack both fire', async () => {
    const tracks = [track('j1', 1), track('j2', 2), track('j3', 3)];
    await service.playPlaylist(tracks, 0);

    finish(instances[0]);
    mediaHandlers['nexttrack']?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.currentTrack$.value?.id).toBe('j2');
    expect(service.isPlaying$.value).toBe(true);
  });

  it('falls back to the same element when the next chapter is not actually preloaded', async () => {
    await startTwoChapterPlaylist();
    const playingEl = instances[0];
    const preloadEl = instances[1];
    // A src on the other element is not enough — it must be our preloaded blob.
    preloadEl.src = 'https://example.com/j2.mp3';
    preloadEl.readyState = 4;

    finish(playingEl);
    await Promise.resolve();
    await Promise.resolve();

    expect(playingEl.src).toContain('j2.mp3');
    expect(playingEl.paused).toBe(false);
    expect(preloadEl.paused).toBe(true);
    expect(service.currentTrack$.value?.id).toBe('j2');
  });

  it('calls play() before notifying trackEnded subscribers', async () => {
    await startTwoChapterPlaylist();
    const playingEl = instances[0];
    let playCalled = false;
    const originalPlay = playingEl.play.bind(playingEl);
    playingEl.play = () => {
      playCalled = true;
      return originalPlay();
    };

    let notifiedBeforePlay = false;
    const sub = service.trackEnded$.subscribe(t => {
      if (t && t.id === 'j1' && !playCalled) notifiedBeforePlay = true;
    });

    finish(playingEl);
    sub.unsubscribe();

    expect(playCalled).toBe(true);
    expect(notifiedBeforePlay).toBe(false);
  });

  it('starts the next chapter muted before the current one ends when preload is ready', async () => {
    const tracks = await startTwoChapterPlaylist();
    const current = instances[0];
    const nextEl = instances[1];

    // Simulate a fully buffered next chapter on the inactive element.
    nextEl.src = 'blob:j2';
    nextEl.readyState = 4;
    (service as unknown as { preloaded: { track: Track; url: string; ready: boolean } }).preloaded = {
      track: tracks[1],
      url: 'blob:j2',
      ready: true,
    };

    current.currentTime = current.duration - 0.2;
    current.dispatchEvent(new Event('timeupdate'));

    expect(nextEl.paused).toBe(false);
    expect(nextEl.muted).toBe(true);
    expect(current.paused).toBe(false);

    finish(current);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.currentTrack$.value?.id).toBe('j2');
    expect(service.isPlaying$.value).toBe(true);
    expect(nextEl.muted).toBe(false);
    expect(nextEl.paused).toBe(false);
  });
});
