import { AvailableSpace } from '../storage/my-db';
import { audioStorage } from '../storage/audio-storage';
import { AudioDownloaderService } from './audio-downloader.service';
import { Track } from '../models/track';
import { runOnPlatform } from '../../testing/fake-capacitor';

type Progress = { downloaded: number; total: number; status: string; context?: string; currentTrack?: Track };

function track(n: number): Track {
  return {
    id: `ara-gn-${n}`, book: 'Gênesis', chapter: n, title: `Gênesis ${n}`,
    fileName: `Genesis/Genesis ${n}.mp3`, url: `https://cdn/GN/GN ${n}.mp3`, status: 'pending',
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * A fake device store behind the real `audioStorage` singleton, so the
 * service is exercised through its public API only.
 */
function fakeStore() {
  const stored = new Set<string>();
  const transfers: string[] = [];
  let behaviour: (id: string, signal?: AbortSignal) => Promise<void> = async () => {};
  vi.spyOn(audioStorage, 'has').mockImplementation(async id => stored.has(id));
  vi.spyOn(audioStorage, 'download').mockImplementation(async (id, _url, signal) => {
    transfers.push(id);
    await behaviour(id, signal);
    stored.add(id);
  });
  vi.spyOn(audioStorage, 'list').mockImplementation(async () =>
    [...stored].map((id, i) => ({ id, size: 100, downloadedAt: i })));
  vi.spyOn(audioStorage, 'remove').mockImplementation(async id => { stored.delete(id); });
  vi.spyOn(audioStorage, 'clear').mockImplementation(async () => stored.clear());
  vi.spyOn(audioStorage, 'playableUrl').mockImplementation(async id => stored.has(id) ? `blob:${id}` : null);
  return {
    stored, transfers,
    behave(fn: typeof behaviour) { behaviour = fn; },
  };
}

describe('AudioDownloaderService', () => {
  let svc: AudioDownloaderService;
  let store: ReturnType<typeof fakeStore>;
  let progress: Progress[];

  beforeEach(() => {
    vi.spyOn(AvailableSpace.prototype, 'isSafe').mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store = fakeStore();
    svc = new AudioDownloaderService();
    progress = [];
    svc.downloadProgress$.subscribe(p => progress.push(p));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('a single chapter', () => {
    it('downloads it, marks it done and announces it', async () => {
      const landed: Track[] = [];
      svc.trackDownloaded$.subscribe(t => landed.push(t));
      const t = track(1);
      await svc.download(t);
      expect(t.status).toBe('done');
      expect(await svc.isDownloaded(t)).toBe(true);
      expect(await svc.localUrl(t)).toBe('blob:ara-gn-1');
      expect(landed).toEqual([t]);
    });

    it('does not download a chapter that is already on the device', async () => {
      store.stored.add('ara-gn-1');
      const t = track(1);
      await svc.download(t);
      expect(store.transfers).toEqual([]);
      expect(t.status).toBe('done');
    });

    it('recognises chapters stored under the legacy fileName key', async () => {
      const t = track(1);
      store.stored.add(t.fileName);
      expect(await svc.isDownloaded(t)).toBe(true);
      expect(await svc.localUrl(t)).toBe(`blob:${t.fileName}`);
    });

    it('marks the chapter as failed and rethrows', async () => {
      store.behave(async () => { throw new Error('HTTP 500'); });
      const landed = vi.fn();
      svc.trackDownloaded$.subscribe(landed);
      const t = track(1);
      await expect(svc.download(t)).rejects.toThrow('HTTP 500');
      expect(t.status).toBe('error');
      expect(await svc.isDownloaded(t)).toBe(false);
      expect(landed).not.toHaveBeenCalled();
    });

    it('fetches a chapter only once when two callers ask at the same time', async () => {
      const gate = deferred();
      store.behave(() => gate.promise);
      const a = svc.download(track(1));
      const b = svc.download(track(1));
      gate.resolve();
      await Promise.all([a, b]);
      expect(store.transfers).toEqual(['ara-gn-1']);
    });
  });

  describe('a batch of chapters', () => {
    it('downloads all of them, reporting progress through to completed', async () => {
      const tracks = [1, 2, 3, 4].map(track);
      await svc.downloadTracks(tracks, 'full-bible');
      expect(store.transfers.sort()).toEqual(tracks.map(t => t.id).sort());
      expect(progress[0]).toMatchObject({ downloaded: 0, total: 4, status: 'running', context: 'full-bible' });
      expect(progress.at(-1)).toMatchObject({ downloaded: 4, total: 4, status: 'completed', context: 'full-bible' });
      expect(progress.map(p => p.downloaded)).toEqual([...progress.map(p => p.downloaded)].sort((a, b) => a - b));
    });

    it('downloads at most three chapters in parallel', async () => {
      let inFlight = 0;
      let peak = 0;
      store.behave(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 2));
        inFlight--;
      });
      await svc.downloadTracks([1, 2, 3, 4, 5, 6, 7].map(track));
      expect(peak).toBe(3);
      expect(store.transfers.length).toBe(7);
    });

    it('is already complete when every chapter is on the device', async () => {
      [1, 2].forEach(n => store.stored.add(`ara-gn-${n}`));
      await svc.downloadTracks([1, 2].map(track));
      expect(store.transfers).toEqual([]);
      expect(progress).toEqual([expect.objectContaining({ downloaded: 2, total: 2, status: 'completed' })]);
    });

    it('keeps going when one chapter fails in the middle', async () => {
      store.behave(async id => { if (id === 'ara-gn-2') throw new Error('HTTP 404'); });
      const tracks = [1, 2, 3, 4].map(track);
      await svc.downloadTracks(tracks);
      expect(tracks.map(t => t.status)).toEqual(['done', 'error', 'done', 'done']);
      expect(progress.at(-1)).toMatchObject({ downloaded: 3, total: 4, status: 'completed' });
    });

    it('resumes where it left off: a second run only fetches what is missing', async () => {
      store.behave(async id => { if (id === 'ara-gn-3') throw new Error('offline'); });
      await svc.downloadTracks([1, 2, 3, 4].map(track));
      store.transfers.length = 0;
      store.behave(async () => {});
      progress = [];

      await svc.downloadTracks([1, 2, 3, 4].map(track));
      expect(store.transfers).toEqual(['ara-gn-3']);
      expect(progress[0]).toMatchObject({ downloaded: 3, total: 4, status: 'running' });
      expect(progress.at(-1)).toMatchObject({ downloaded: 4, total: 4, status: 'completed' });
    });

    it('on the web, gives up (status error) when nothing finishes for a minute', async () => {
      vi.useFakeTimers();
      let aborted = false;
      store.behave((_id, signal) => new Promise((_, reject) => {
        signal?.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
      }));
      const run = svc.downloadTracks([1, 2, 3, 4].map(track));
      await vi.advanceTimersByTimeAsync(59_000);
      expect(progress.at(-1)?.status).toBe('running');
      await vi.advanceTimersByTimeAsync(10_000);
      await run;
      expect(aborted).toBe(true);
      expect(progress.at(-1)).toMatchObject({ downloaded: 0, total: 4, status: 'error' });
      // Chapters not yet started were never attempted once it gave up.
      expect(store.transfers.length).toBe(3);
    });

    it('in the native app, a long quiet stretch (screen off) does not cancel the batch', async () => {
      runOnPlatform('android');
      vi.useFakeTimers();
      const gate = deferred();
      store.behave(() => gate.promise);
      const run = svc.downloadTracks([1, 2].map(track));
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      gate.resolve();
      await vi.runAllTimersAsync();
      await run;
      expect(progress.at(-1)).toMatchObject({ downloaded: 2, total: 2, status: 'completed' });
    });
  });

  describe('bookkeeping', () => {
    it('counts, sizes and clears downloaded chapters', async () => {
      await svc.download(track(1));
      await svc.download(track(2));
      expect(await svc.getDownloadedCount()).toBe(2);
      expect(await svc.getDownloadedBytes()).toBe(200);
      await svc.clearAll();
      expect(await svc.getDownloadedCount()).toBe(0);
    });

    it('removes the oldest chapters first', async () => {
      for (const n of [1, 2, 3, 4]) await svc.download(track(n));
      expect(await svc.removeOldest(2)).toEqual(['ara-gn-1', 'ara-gn-2']);
      expect([...store.stored]).toEqual(['ara-gn-3', 'ara-gn-4']);
    });
  });

  describe('ensureFreeDiskSpace', () => {
    it('keeps evicting the oldest chapters until there is room', async () => {
      vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(5);
      vi.spyOn(AvailableSpace.prototype, 'isSafe')
        .mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
      const removeOldest = vi.spyOn(svc, 'removeOldest').mockResolvedValue(['a', 'b', 'c']);
      await svc.ensureFreeDiskSpace();
      expect(removeOldest).toHaveBeenCalledTimes(2);
    });

    it('gives up instead of spinning forever when there is nothing left to evict', async () => {
      vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(5);
      const isSafe = vi.spyOn(AvailableSpace.prototype, 'isSafe').mockResolvedValue(false);
      vi.spyOn(svc, 'removeOldest').mockResolvedValue([]);
      await expect(svc.ensureFreeDiskSpace()).resolves.toBeUndefined();
      expect(isSafe).toHaveBeenCalledTimes(1);
    });

    it('frees space before downloading a chapter', async () => {
      vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(5);
      vi.spyOn(AvailableSpace.prototype, 'isSafe').mockResolvedValueOnce(false).mockResolvedValue(true);
      store.stored.add('ara-ex-1');
      await svc.download(track(1));
      expect([...store.stored]).toEqual(['ara-gn-1']);
    });
  });
});
