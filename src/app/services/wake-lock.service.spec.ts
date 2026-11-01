import { WakeLockService } from './wake-lock.service';
import { capacitorPlugins } from '../utils/capacitor-plugins';
import { runOnPlatform } from '../../testing/fake-capacitor';

const flush = () => new Promise(r => setTimeout(r, 0));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('WakeLockService', () => {
  // Every instance listens on `document` for good (it's a root singleton in
  // the app), so release each one to keep tests independent.
  const created: WakeLockService[] = [];
  const make = () => { const s = new WakeLockService(); created.push(s); return s; };

  afterEach(() => {
    created.splice(0).forEach(s => s.release());
    vi.restoreAllMocks();
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    setVisibility('visible');
  });

  describe('native app', () => {
    it('keeps the screen on through KeepAwake and lets it sleep again', async () => {
      runOnPlatform('ios');
      const KeepAwake = { keepAwake: vi.fn().mockResolvedValue(undefined), allowSleep: vi.fn().mockResolvedValue(undefined) };
      vi.spyOn(capacitorPlugins, 'keepAwake').mockResolvedValue({ KeepAwake } as never);
      const svc = make();

      await svc.request();
      expect(KeepAwake.keepAwake).toHaveBeenCalledTimes(1);
      svc.release();
      await flush();
      expect(KeepAwake.allowSleep).toHaveBeenCalledTimes(1);
    });

    it('does not fail the download when KeepAwake is unavailable', async () => {
      runOnPlatform('android');
      const KeepAwake = { keepAwake: vi.fn().mockRejectedValue(new Error('not implemented')), allowSleep: vi.fn() };
      vi.spyOn(capacitorPlugins, 'keepAwake').mockResolvedValue({ KeepAwake } as never);
      await expect(make().request()).resolves.toBeUndefined();
    });
  });

  describe('browser', () => {
    function fakeWakeLock() {
      const sentinels: (EventTarget & { release: ReturnType<typeof vi.fn> })[] = [];
      const api = {
        request: vi.fn(async () => {
          const s = Object.assign(new EventTarget(), {
            release: vi.fn(async () => { s.dispatchEvent(new Event('release')); }),
          });
          sentinels.push(s);
          return s;
        }),
      };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: api });
      return { api, sentinels };
    }

    beforeEach(() => runOnPlatform('web'));

    it('holds a screen wake lock while wanted and releases it after', async () => {
      const { api, sentinels } = fakeWakeLock();
      const svc = make();
      await svc.request();
      expect(api.request).toHaveBeenCalledWith('screen');
      svc.release();
      expect(sentinels[0].release).toHaveBeenCalled();
    });

    it('re-acquires the lock when the tab comes back while still wanted', async () => {
      const { api, sentinels } = fakeWakeLock();
      const svc = make();
      await svc.request();
      // The browser drops the lock when the tab is hidden.
      setVisibility('hidden');
      sentinels[0].dispatchEvent(new Event('release'));
      setVisibility('visible');
      await flush();
      expect(api.request).toHaveBeenCalledTimes(2);
    });

    it('does not re-acquire after release', async () => {
      const { api } = fakeWakeLock();
      const svc = make();
      await svc.request();
      svc.release();
      setVisibility('visible');
      await flush();
      expect(api.request).toHaveBeenCalledTimes(1);
    });

    it('quietly does nothing where the API is missing or refused', async () => {
      await expect(make().request()).resolves.toBeUndefined();
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true, value: { request: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) },
      });
      await expect(make().request()).resolves.toBeUndefined();
    });
  });
});
