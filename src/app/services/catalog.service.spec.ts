import { TestBed } from '@angular/core/testing';

import { CATALOG_URL, CatalogService } from './catalog.service';
import { AudioDownloaderService } from './audio-downloader.service';
import { catalogEntry, currentCatalog, narratorChoices, resetCatalog, setCatalog, versionsForLanguage } from '../data/bible-catalog';
import { audioStorage } from '../storage/audio-storage';
import { FIVE_LICENSED as FIVE } from '../../testing/bible-catalog';

describe('CatalogService', () => {
  const otb = { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB', narrators: [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana' }] };
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: CatalogService;
  let changes: number;

  const serve = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });

  beforeEach(() => {
    localStorage.clear();
    resetCatalog();
    setCatalog(FIVE);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service = TestBed.inject(CatalogService);
    changes = 0;
    service.changed$.subscribe(() => changes++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetCatalog();
    Reflect.deleteProperty(navigator, 'connection');
  });

  it('shares one check with a caller that arrives while it is running', async () => {
    let release: (body: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const first = service.refresh();
    const waiting = service.whenReady();
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    release({ ok: true, json: async () => ({ bibles: [...FIVE, otb] }) });
    expect(await first).toBe(true);
    await waiting;
    expect(settled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(versionsForLanguage('pt').map(e => e.version)).toEqual(['ara', 'otb']);
  });

  it('takes a new version and narrators from the CDN, with no app update', async () => {
    serve({ bibles: [...FIVE, otb] });
    expect(await service.refresh()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(CATALOG_URL, { cache: 'no-store' });
    expect(versionsForLanguage('pt').map(e => e.version)).toEqual(['ara', 'otb']);
    expect(narratorChoices(catalogEntry('pt', 'otb')).map(n => n.id)).toEqual(['ariel', 'ana']);
    expect(changes).toBe(1);
  });

  it('says nothing when the list is the one already in use', async () => {
    serve({ bibles: FIVE });
    expect(await service.refresh()).toBe(false);
    expect(changes).toBe(0);
  });

  it('keeps the list it has when the file is missing, malformed or unreachable', async () => {
    serve({ bibles: [...FIVE, otb] });
    await service.refresh();
    const good = currentCatalog();

    serve(null, false);
    expect(await service.refresh()).toBe(false);
    serve({ bibles: [{ lang: 'pt' }] });
    expect(await service.refresh()).toBe(false);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await service.refresh()).toBe(false);

    expect(currentCatalog()).toBe(good);
    expect(changes).toBe(1);
  });

  it('does not take away the version this device is using', async () => {
    serve({ bibles: [...FIVE, otb] });
    await service.refresh();
    localStorage.setItem('selectedBible', 'pt-otb');

    serve({ bibles: FIVE });
    await service.refresh();
    expect(catalogEntry('pt', 'otb')?.label).toBe('Português - OTB');
    expect(versionsForLanguage('pt')[0].version).toBe('ara');
  });

  it('on wifi, asks for stored chapters whose revision moved even when the list did not change', async () => {
    const otb = {
      lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB',
      narrators: [
        { id: 'ariel', label: 'Ariel', chapterRev: { GEN: { '1': 2 } } },
        { id: 'lucas', label: 'Lucas' },
      ],
    };
    serve({ bibles: [otb] });
    expect(await service.refresh()).toBe(true);

    Object.defineProperty(navigator, 'connection', { configurable: true, value: { type: 'wifi' } });
    vi.spyOn(audioStorage, 'list').mockResolvedValue([
      { id: 'otb-ariel-Gn-1', size: 10, downloadedAt: 1 },
      { id: 'otb-lucas-Gn-1', size: 10, downloadedAt: 1 },
      { id: 'not-a-chapter', size: 1, downloadedAt: 1 },
    ]);
    const prefetch = vi.spyOn(TestBed.inject(AudioDownloaderService), 'prefetchStaleOnWifi').mockImplementation(() => {});
    expect(await service.refresh()).toBe(false);
    await vi.waitFor(() => expect(prefetch).toHaveBeenCalled());
    const tracks = prefetch.mock.calls[0][0];
    expect(tracks.map(t => t.id)).toEqual(['otb-ariel-Gn-1']);
    expect(tracks[0].rev).toBe(2);
    expect(tracks[0].url).toContain('/audios/pt/OTB/GEN/GEN 1.mp3');
  });

  it('looks for those chapters when the connection changes, and not while it is off wifi', async () => {
    const connection = new EventTarget() as EventTarget & { type?: string };
    connection.type = 'cellular';
    Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    const list = vi.spyOn(audioStorage, 'list').mockResolvedValue([]);
    service.listen();
    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();

    connection.type = 'wifi';
    connection.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
  });
});
