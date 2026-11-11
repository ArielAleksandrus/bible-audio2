import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { IS_NATIVE_APP, NATIVE_LEVEL, NATIVE_UPDATER, OtaService, newer } from './ota.service';
import { UiService } from './ui.service';

const MANIFEST = 'https://bible-audio2.vercel.app/ota/manifest.json';

describe('OtaService', () => {
  const updater = {
    ready: vi.fn(), bundles: vi.fn(), download: vi.fn(), next: vi.fn(),
    onResume: vi.fn(), shell: vi.fn(), openStore: vi.fn(),
  };
  const ui = { actionToast: vi.fn() };
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: OtaService;

  const serve = (manifest: unknown, ok = true) =>
    fetchMock.mockResolvedValue({ ok, json: async () => manifest });
  const manifest = (over: Record<string, unknown> = {}) => ({
    version: '2.1.0', native_level: NATIVE_LEVEL, url: '2.1.0.zip', checksum: 'abc123', ...over,
  });

  function setup(native = true) {
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        { provide: NATIVE_UPDATER, useValue: updater },
        { provide: IS_NATIVE_APP, useValue: native },
        { provide: UiService, useValue: ui },
      ],
    });
    service = TestBed.inject(OtaService);
    service.manifestUrl = MANIFEST;
    service.appVersion = '2.0.0';
  }

  beforeEach(() => {
    vi.clearAllMocks();
    updater.ready.mockResolvedValue(undefined);
    updater.bundles.mockResolvedValue([]);
    updater.download.mockResolvedValue({ id: 'b1' });
    updater.next.mockResolvedValue(undefined);
    updater.shell.mockResolvedValue({ platform: 'android', version: '2.0.0' });
    ui.actionToast.mockResolvedValue(false);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    serve(manifest());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does nothing in the browser', () => {
    setup(false);
    service.listen();
    expect(updater.ready).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirms the bundle opened, checks on launch and again on resume', async () => {
    setup();
    service.listen();
    expect(updater.ready).toHaveBeenCalled();
    await vi.waitFor(() => expect(updater.next).toHaveBeenCalledWith('b1'));
    expect(fetchMock).toHaveBeenCalledWith(MANIFEST, { cache: 'no-store' });

    updater.onResume.mock.calls[0][0]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('still confirms the bundle opened when there is no manifest URL', () => {
    setup();
    service.manifestUrl = '';
    service.listen();
    expect(updater.ready).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads a newer version of the same native level and queues it', async () => {
    setup();
    await service.check();
    expect(updater.download).toHaveBeenCalledWith('https://bible-audio2.vercel.app/ota/2.1.0.zip', '2.1.0', 'abc123');
    expect(updater.next).toHaveBeenCalledWith('b1');
  });

  it('ignores the same or an older version', async () => {
    setup();
    serve(manifest({ version: '2.0.0' }));
    await service.check();
    serve(manifest({ version: '1.9.9' }));
    await service.check();
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).not.toHaveBeenCalled();
  });

  it('ignores a bundle made for another native level', async () => {
    setup();
    serve(manifest({ version: '3.0.0', native_level: NATIVE_LEVEL + 1 }));
    await service.check();
    expect(updater.download).not.toHaveBeenCalled();
  });

  it('reuses a bundle already downloaded and skips one that failed to open', async () => {
    setup();
    updater.bundles.mockResolvedValue([{ id: 'b9', version: '2.1.0', status: 'pending' }]);
    await service.check();
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).toHaveBeenCalledWith('b9');

    updater.next.mockClear();
    updater.bundles.mockResolvedValue([{ id: 'b9', version: '2.1.0', status: 'error' }]);
    await service.check();
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).not.toHaveBeenCalled();
  });

  it('stays on the current version when the manifest or the download fails', async () => {
    setup();
    serve({}, false);
    await service.check();
    serve({ version: '2.1.0' });
    await service.check();
    fetchMock.mockRejectedValue(new Error('offline'));
    await service.check();
    expect(updater.download).not.toHaveBeenCalled();

    serve(manifest());
    updater.download.mockRejectedValueOnce(new Error('Checksum verification failed'));
    await service.check();
    expect(updater.next).not.toHaveBeenCalled();
  });

  describe('store notice', () => {
    it('offers the store when it has published a newer major, once per launch', async () => {
      setup();
      serve(manifest({ version: '3.0.0', native_level: NATIVE_LEVEL + 1, store: { android: '3.0.0', ios: null } }));
      ui.actionToast.mockResolvedValue(true);
      await service.check();
      await vi.waitFor(() => expect(updater.openStore).toHaveBeenCalledWith('market://details?id=live.nlabs.biblia'));

      await service.check();
      expect(ui.actionToast).toHaveBeenCalledTimes(1);
    });

    it('stays quiet when the notice is dismissed', async () => {
      setup();
      serve(manifest({ store: { android: '3.0.0' } }));
      await service.check();
      await vi.waitFor(() => expect(ui.actionToast).toHaveBeenCalled());
      expect(updater.openStore).not.toHaveBeenCalled();
    });

    it('says nothing for a minor or patch in the store (it arrives over the air)', async () => {
      setup();
      serve(manifest({ store: { android: '2.4.1' } }));
      await service.check();
      await vi.waitFor(() => expect(updater.shell).toHaveBeenCalled());
      expect(ui.actionToast).not.toHaveBeenCalled();
    });

    it('says nothing until that platform’s store has the version', async () => {
      setup();
      updater.shell.mockResolvedValue({ platform: 'ios', version: '2.0.0' });
      serve(manifest({ store: { android: '3.0.0', ios: null } }));
      await service.check();
      await vi.waitFor(() => expect(updater.shell).toHaveBeenCalled());
      expect(ui.actionToast).not.toHaveBeenCalled();
    });

    it('sends the iPhone to the App Store', async () => {
      setup();
      updater.shell.mockResolvedValue({ platform: 'ios', version: '2.0.0' });
      serve(manifest({ store: { ios: '3.0.0' } }));
      ui.actionToast.mockResolvedValue(true);
      await service.check();
      await vi.waitFor(() => expect(updater.openStore).toHaveBeenCalledWith('https://apps.apple.com/app/id6832831597'));
    });
  });
});

describe('newer', () => {
  it('compares x.y.z numerically', () => {
    expect(newer('2.0.10', '2.0.9')).toBe(true);
    expect(newer('2.1.0', '2.0.9')).toBe(true);
    expect(newer('3.0.0', '2.9.9')).toBe(true);
    expect(newer('2.0.0', '2.0.0')).toBe(false);
    expect(newer('1.9.9', '2.0.0')).toBe(false);
  });
});
