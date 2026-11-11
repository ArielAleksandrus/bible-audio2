import { TestBed } from '@angular/core/testing';

import { CATALOG_URL, CatalogService } from './catalog.service';
import { BUNDLED_CATALOG, catalogEntry, currentCatalog, narratorChoices, resetCatalog, versionsForLanguage } from '../data/bible-catalog';

describe('CatalogService', () => {
  const otb = { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB', narrators: [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana' }] };
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: CatalogService;
  let changes: number;

  const serve = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });

  beforeEach(() => {
    localStorage.clear();
    resetCatalog();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service = TestBed.inject(CatalogService);
    changes = 0;
    service.changed$.subscribe(() => changes++);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCatalog();
  });

  it('takes a new version and narrators from the CDN, with no app update', async () => {
    serve({ bibles: [...BUNDLED_CATALOG, otb] });
    expect(await service.refresh()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(CATALOG_URL, { cache: 'no-store' });
    expect(versionsForLanguage('pt').map(e => e.version)).toEqual(['ara', 'otb']);
    expect(narratorChoices(catalogEntry('pt', 'otb')).map(n => n.id)).toEqual(['ariel', 'ana']);
    expect(changes).toBe(1);
  });

  it('says nothing when the list is the one already in use', async () => {
    serve({ bibles: BUNDLED_CATALOG });
    expect(await service.refresh()).toBe(false);
    expect(changes).toBe(0);
  });

  it('keeps the list it has when the file is missing, malformed or unreachable', async () => {
    serve({ bibles: [...BUNDLED_CATALOG, otb] });
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
    serve({ bibles: [...BUNDLED_CATALOG, otb] });
    await service.refresh();
    localStorage.setItem('selectedBible', 'pt-otb');

    serve({ bibles: BUNDLED_CATALOG });
    await service.refresh();
    expect(catalogEntry('pt', 'otb')?.label).toBe('Português - OTB');
    expect(versionsForLanguage('pt')[0].version).toBe('ara');
  });
});
