import { AvailableSpace } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';
import { audioStorage } from '../storage/audio-storage';
import { clearStoredRevs, setStoredRev, storedRev } from '../storage/audio-revs';
import { Track } from '../models/track';

describe('AudioDownloaderService.ensureFreeDiskSpace', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lets the download go on when there is room', async () => {
    vi.spyOn(AvailableSpace.prototype, 'isSafe').mockResolvedValue(true);
    await expect(new AudioDownloaderService().ensureFreeDiskSpace()).resolves.toBeUndefined();
  });

  it('refuses the download and says so when the device is almost full, deleting nothing', async () => {
    vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(5);
    vi.spyOn(AvailableSpace.prototype, 'isSafe').mockResolvedValue(false);
    const svc = new AudioDownloaderService();
    const remove = vi.spyOn(svc, 'removeById');
    let told = 0;
    svc.lowSpace$.subscribe(() => told++);
    await expect(svc.ensureFreeDiskSpace()).rejects.toThrow('5 MB');
    expect(told).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('AudioDownloaderService: a chapter republished at a newer revision', () => {
  const track = (rev?: number): Track => ({
    id: 'otb-ariel-gn-1', book: 'Gênesis', chapter: 1, title: 'Gênesis 1', fileName: 'otb-gn-1',
    url: 'https://cdn/GEN 1.m4a', status: 'pending', ...(rev ? { rev } : {}),
  });
  let stored: Map<string, string>;
  let download: ReturnType<typeof vi.spyOn>;
  let release: () => void;

  beforeEach(() => {
    localStorage.clear();
    clearStoredRevs();
    stored = new Map([['otb-ariel-gn-1', 'old']]);
    const gate = new Promise<void>(r => (release = r));
    vi.spyOn(audioStorage, 'playableUrl').mockImplementation(async id => stored.has(id) ? `blob:${stored.get(id)}` : null);
    vi.spyOn(audioStorage, 'remove').mockImplementation(async id => { stored.delete(id); });
    download = vi.spyOn(audioStorage, 'download').mockImplementation(async id => { await gate; stored.set(id, 'new'); });
  });
  afterEach(() => vi.restoreAllMocks());

  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  it('plays the file on the device right away and fetches the new one behind it', async () => {
    const svc = new AudioDownloaderService();
    expect(await svc.localUrl(track(2))).toBe('blob:old');
    expect(download).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(await svc.localUrl(track(2))).toBe('blob:new');
    expect(storedRev('otb-ariel-gn-1')).toBe(2);
    expect(download).toHaveBeenCalledTimes(1); // up to date now: not fetched again
  });

  it('fetches nothing when the stored file is already at the catalog revision', async () => {
    const svc = new AudioDownloaderService();
    expect(await svc.localUrl(track())).toBe('blob:old');
    setStoredRev('otb-ariel-gn-1', 3);
    expect(await svc.localUrl(track(2))).toBe('blob:old');
    expect(download).not.toHaveBeenCalled();
  });

  it('fetches a chapter only once while its new revision is on the way', async () => {
    const svc = new AudioDownloaderService();
    await svc.localUrl(track(2));
    await svc.localUrl(track(2));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('keeps the old file when the new one fails, and tries again later', async () => {
    download.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = new AudioDownloaderService();
    await svc.localUrl(track(2));
    await settle();
    expect(stored.get('otb-ariel-gn-1')).toBe('old');
    expect(storedRev('otb-ariel-gn-1')).toBe(1);
    await svc.localUrl(track(2));
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('moves a chapter kept under an old key to its id', async () => {
    stored = new Map([['otb-gn-1', 'old']]);
    const svc = new AudioDownloaderService();
    expect(await svc.localUrl(track(2))).toBe('blob:old');
    release();
    await settle();
    expect([...stored.keys()]).toEqual(['otb-ariel-gn-1']);
  });

  it('writes down the revision a chapter was downloaded at', async () => {
    stored.clear();
    vi.spyOn(AvailableSpace.prototype, 'isSafe').mockResolvedValue(true);
    vi.spyOn(audioStorage, 'has').mockResolvedValue(false);
    release();
    await new AudioDownloaderService().download(track(2));
    expect(storedRev('otb-ariel-gn-1')).toBe(2);
  });
});
