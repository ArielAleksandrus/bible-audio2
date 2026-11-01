import { WebAudioEngine } from './web-audio-engine';
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

describe('WebAudioEngine auto-advance', () => {
  let instances: FakeAudio[];
  let mediaHandlers: Record<string, Function | null>;
  let service: WebAudioEngine;
  let downloader: { download: ReturnType<typeof vi.fn>; localUrl: ReturnType<typeof vi.fn> };
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

    downloader = { download: vi.fn().mockResolvedValue(undefined), localUrl: vi.fn().mockResolvedValue(null) };
    analytics = { chapterCompleted: vi.fn() };
    service = new WebAudioEngine(
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

    await vi.advanceTimersByTimeAsync(5000);
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

  it('does not advance well before the current chapter is near its end', async () => {
    await startTwoChapterPlaylist();
    const current = instances[0];
    current.currentTime = current.duration - 1;
    current.dispatchEvent(new Event('timeupdate'));
    await Promise.resolve();

    expect(service.currentTrack$.value?.id).toBe('j1');
    expect(current.paused).toBe(false);
  });

  it('hands off a little before the real `ended` event once timeupdate reports the chapter is basically done', async () => {
    // 1.0.3's proven behavior: advance on timeupdate once we're in the last
    // ~0.35s, instead of waiting for the literal `ended` event. By then the
    // primed next chapter has had the whole lead window to settle, which is
    // what makes the handoff glitch-free — waiting for the exact boundary
    // is what stutters.
    vi.useFakeTimers();
    const tracks = await startTwoChapterPlaylist();
    // Let the post-start transition window (which also guards against
    // advancing twice) close before simulating the chapter's real end.
    await vi.advanceTimersByTimeAsync(3000);
    const current = instances[0];
    const nextEl = instances[1];
    nextEl.src = 'blob:j2';
    nextEl.readyState = 4;
    (service as unknown as { preloaded: { track: Track; url: string; ready: boolean } }).preloaded = {
      track: tracks[1],
      url: 'blob:j2',
      ready: true,
    };

    // Primed a couple of seconds out, same as a real device.
    current.currentTime = current.duration - 2;
    current.dispatchEvent(new Event('timeupdate'));
    expect(nextEl.paused).toBe(false);

    // The chapter is basically done — hand off before the real `ended` fires.
    current.currentTime = current.duration - 0.2;
    current.dispatchEvent(new Event('timeupdate'));
    await Promise.resolve();
    await Promise.resolve();

    expect(service.currentTrack$.value?.id).toBe('j2');
    expect(nextEl.paused).toBe(false);
    expect(current.paused).toBe(true);
  });

  it('starts the next chapter once at volume 0 shortly before the current one ends', async () => {
    const tracks = await startTwoChapterPlaylist();
    const current = instances[0];
    const nextEl = instances[1];
    nextEl.src = 'blob:j2';
    nextEl.readyState = 4;
    (service as unknown as { preloaded: { track: Track; url: string; ready: boolean } }).preloaded = {
      track: tracks[1],
      url: 'blob:j2',
      ready: true,
    };

    let playCount = 0;
    const originalPlay = nextEl.play.bind(nextEl);
    nextEl.play = () => {
      playCount += 1;
      return originalPlay();
    };

    current.currentTime = current.duration - 0.4;
    current.dispatchEvent(new Event('timeupdate'));
    nextEl.currentTime = 0.2;
    current.dispatchEvent(new Event('timeupdate'));

    expect(nextEl.paused).toBe(false);
    expect(nextEl.volume).toBe(0);
    expect(playCount).toBe(1);
    expect(nextEl.currentTime).toBe(0.2);
    expect(current.paused).toBe(false);
    expect(service.currentTrack$.value?.id).toBe('j1');
  });

  it('uses the same element and a preloaded blob for the next chapter', async () => {
    const tracks = await startTwoChapterPlaylist();
    const current = instances[0];
    const nextEl = instances[1];

    nextEl.src = 'blob:j2';
    nextEl.readyState = 4;
    (service as unknown as { preloaded: { track: Track; url: string; ready: boolean } }).preloaded = {
      track: tracks[1],
      url: 'blob:j2',
      ready: true,
    };

    finish(current);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.currentTrack$.value?.id).toBe('j2');
    expect(current.src).toBe('blob:j2');
    expect(current.paused).toBe(false);
    expect(nextEl.paused).toBe(true);
  });

  it('resumes the next chapter when the OS pauses it right after auto-advance', async () => {
    await startTwoChapterPlaylist();
    const playingEl = instances[0];

    finish(playingEl);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.currentTrack$.value?.id).toBe('j2');
    expect(playingEl.paused).toBe(false);

    // Android Now Playing / Media Session pauses the new element after ended.
    playingEl.pause();
    await Promise.resolve();

    expect(playingEl.paused).toBe(false);
    expect(service.isPlaying$.value).toBe(true);
    expect(navigator.mediaSession.playbackState).toBe('playing');
  });

  it('resumes from a media-session pause during the chapter-change hold', async () => {
    await startTwoChapterPlaylist();
    const playingEl = instances[0];

    finish(playingEl);
    await Promise.resolve();
    await Promise.resolve();
    playingEl.pause();
    mediaHandlers['pause']?.();
    await Promise.resolve();

    expect(playingEl.paused).toBe(false);
    expect(service.isPlaying$.value).toBe(true);
  });

  it('bypasses the service worker when falling back to a network URL', async () => {
    await startTwoChapterPlaylist();
    const playingEl = instances[0];

    finish(playingEl);
    await Promise.resolve();
    await Promise.resolve();

    expect(playingEl.src).toContain('j2.mp3');
    expect(playingEl.src).toContain('ngsw-bypass');
  });

  describe('controls', () => {
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    it('pauses and resumes the current chapter', async () => {
      await startTwoChapterPlaylist();
      service.pause();
      expect(service.isPlaying$.value).toBe(false);
      expect(navigator.mediaSession.playbackState).toBe('paused');

      service.play();
      expect(service.isPlaying$.value).toBe(true);
      expect(service.currentTrack$.value?.id).toBe('j1');

      service.toggle();
      expect(service.isPlaying$.value).toBe(false);
      service.toggle();
      expect(service.isPlaying$.value).toBe(true);
    });

    it('a user pause near the end of a chapter does not auto-advance', async () => {
      await startTwoChapterPlaylist();
      const el = instances[0];
      service.pause();
      el.currentTime = el.duration - 0.1;
      el.dispatchEvent(new Event('timeupdate'));
      await flush();
      expect(service.currentTrack$.value?.id).toBe('j1');
      expect(service.isPlaying$.value).toBe(false);
    });

    it('seeks and skips within the chapter', async () => {
      await startTwoChapterPlaylist();
      service.seekTo(30);
      expect(service.timeUpdate$.value).toEqual({ currentTime: 30, duration: 120 });
      service.skip(10);
      expect(service.timeUpdate$.value.currentTime).toBe(40);
      service.skip(-100);
      expect(service.timeUpdate$.value.currentTime).toBe(0);
      service.skip(500);
      expect(service.timeUpdate$.value.currentTime).toBe(120);
    });

    it('reports where it is in the playlist', async () => {
      await service.playPlaylist([track('j1', 1), track('j2', 2), track('j3', 3)], 1);
      expect(service.currentTrack$.value?.id).toBe('j2');
      expect(service.hasPrevious()).toBe(true);
      expect(service.hasNext()).toBe(true);
    });

    it('skips to the next/previous chapter without counting it as completed', async () => {
      const ended: unknown[] = [];
      service.trackEnded$.subscribe(t => t && ended.push(t));
      await service.playPlaylist([track('j1', 1), track('j2', 2), track('j3', 3)], 0);

      service.next();
      await vi.waitFor(() => expect(service.currentTrack$.value?.id).toBe('j2'));
      service.previous();
      await vi.waitFor(() => expect(service.currentTrack$.value?.id).toBe('j1'));

      expect(ended).toEqual([]);
      expect(analytics.chapterCompleted).not.toHaveBeenCalled();
      expect(service.isPlaying$.value).toBe(true);
    });

    it('switching to another passage mid-chapter replaces the playlist cleanly', async () => {
      const ended: unknown[] = [];
      service.trackEnded$.subscribe(t => t && ended.push(t));
      await startTwoChapterPlaylist();
      instances[0].currentTime = 50;

      await service.playPlaylist([track('ps1', 1), track('ps2', 2)], 0);
      expect(service.currentTrack$.value?.id).toBe('ps1');
      expect(instances[0].src).toContain('ps1.mp3');
      expect(ended).toEqual([]);

      // The new passage auto-advances within itself, not back into John.
      finish(instances[0]);
      await flush();
      expect(service.currentTrack$.value?.id).toBe('ps2');
      expect(ended.map(t => (t as { id: string }).id)).toEqual(['ps1']);
    });

    it('plays a whole book through to its last chapter, then stops', async () => {
      const book = [track('j1', 1), track('j2', 2), track('j3', 3)];
      const ended: string[] = [];
      service.trackEnded$.subscribe(t => t && ended.push(t.id));
      await service.playPlaylist(book, 0);

      for (const expected of ['j2', 'j3']) {
        finish(instances[0]);
        await vi.waitFor(() => expect(service.currentTrack$.value?.id).toBe(expected));
      }
      finish(instances[0]);
      await flush();

      expect(ended).toEqual(['j1', 'j2', 'j3']);
      expect(service.currentTrack$.value?.id).toBe('j3');
      expect(service.isPlaying$.value).toBe(false);
    });

    it('plays a downloaded chapter from the device instead of the network', async () => {
      downloader.localUrl.mockImplementation(async (t: Track) => (t.id === 'j1' ? 'blob:j1' : null));
      await startTwoChapterPlaylist();
      expect(instances[0].src).toBe('blob:j1');
      expect(downloader.download).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'j1' }));
    });

    it('streams a chapter that is not downloaded and caches it in the background', async () => {
      await startTwoChapterPlaylist();
      expect(instances[0].src).toContain('https://example.com/j1.mp3');
      expect(downloader.download).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1' }));
    });

    it('stop silences playback and does not auto-advance afterwards', async () => {
      await startTwoChapterPlaylist();
      service.stop();
      expect(service.isPlaying$.value).toBe(false);
      finish(instances[0]);
      await flush();
      expect(service.currentTrack$.value?.id).toBe('j1');
      expect(analytics.chapterCompleted).not.toHaveBeenCalled();
    });
  });
});
