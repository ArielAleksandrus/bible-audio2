import { AvailableSpace } from '../storage/my-db';
import { AudioDownloaderService } from './audio-downloader.service';

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
