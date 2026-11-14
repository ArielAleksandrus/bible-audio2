import { TestBed } from '@angular/core/testing';
import { Bible } from 'bible-picker';

import { BibleService } from './bible.service';
import { AudioDownloaderService } from './audio-downloader.service';
import { appTestProviders } from '../../testing/test-providers';
import { resetCatalog, setCatalog } from '../data/bible-catalog';

describe('BibleService voices', () => {
  const bible = {
    version: 'otb', language: 'pt-br',
    books: [
      { abbrev: 'Gn', name: 'Gênesis', chapters: [['a'], ['b']] },
      { abbrev: 'Ex', name: 'Êxodo', chapters: [['c']] },
    ],
  } as unknown as Bible;
  let stored: Set<string>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: appTestProviders() });
    setCatalog([{
      lang: 'pt', version: 'otb', flag: '', label: 'OTB',
      narrators: [{ id: 'ariel', label: 'Ariel', books: ['GEN'], bytes: { mp3: 300 } }, { id: 'ana', label: 'Ana' }],
    }]);
    stored = new Set();
    const ads = TestBed.inject(AudioDownloaderService);
    vi.spyOn(ads, 'isDownloaded').mockImplementation(async t => stored.has(t.id));
    vi.spyOn(ads, 'removeById').mockImplementation(async id => { stored.delete(id); });
  });
  afterEach(() => { resetCatalog(); vi.restoreAllMocks(); });

  it('counts only the books a voice has so far', async () => {
    const service = TestBed.inject(BibleService);
    expect(service.voiceTracks(bible, 'ariel').map(t => t.id)).toEqual(['otb-ariel-Gn-1', 'otb-ariel-Gn-2']);
    expect(service.voiceTracks(bible, 'ana')).toHaveLength(3);
    expect(service.bookAvailable(bible, 1)).toBe(false); // Exodus, in Ariel's voice (the one in use)

    stored = new Set(['otb-ariel-Gn-1', 'otb-ariel-Gn-2']);
    expect(await service.isVoiceComplete(bible, 'ariel')).toBe(true);
    expect(await service.narratorsDownloaded(bible)).toEqual(['ariel']);
    expect(await service.anyVoiceComplete(bible)).toBe(true);
  });

  it('sizes what is still missing, from the catalog bytes when given', async () => {
    const service = TestBed.inject(BibleService);
    expect(await service.voiceBytesToDownload(bible, 'ariel')).toBe(300);
    stored = new Set(['otb-ariel-Gn-1']);
    expect(await service.voiceBytesToDownload(bible, 'ariel')).toBe(150);
    expect(await service.voiceBytesToDownload(bible, 'ana')).toBeGreaterThan(0); // estimated
  });

  it('removes one voice and leaves the other', async () => {
    const service = TestBed.inject(BibleService);
    stored = new Set(['otb-ariel-Gn-1', 'otb-ana-Gn-1']);
    await service.removeVoice(bible, 'ariel');
    expect([...stored]).toEqual(['otb-ana-Gn-1']);
  });
});
