import { AvailableSpace } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';

describe('AudioDownloaderService.ensureFreeDiskSpace', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps evicting the oldest chapters until there is room', async () => {
    vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(5);
    vi.spyOn(AvailableSpace.prototype, 'isSafe')
      .mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const svc = new AudioDownloaderService();
    const removeOldest = vi.spyOn(svc, 'removeOldest').mockResolvedValue(['a', 'b', 'c']);
    await svc.ensureFreeDiskSpace();
    expect(removeOldest).toHaveBeenCalledTimes(2);
  });

  it('gives up instead of spinning forever when there is nothing left to evict', async () => {
    vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(5);
    const isSafe = vi.spyOn(AvailableSpace.prototype, 'isSafe').mockResolvedValue(false);
    const svc = new AudioDownloaderService();
    vi.spyOn(svc, 'removeOldest').mockResolvedValue([]);
    await expect(svc.ensureFreeDiskSpace()).resolves.toBeUndefined();
    expect(isSafe).toHaveBeenCalledTimes(1);
  });
});
