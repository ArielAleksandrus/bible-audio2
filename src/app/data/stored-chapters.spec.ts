import { resetCatalog, setCatalog, type BibleCatalogEntry } from './bible-catalog';
import { parseStoredChapterId, trackForStoredId, tracksForStoredIds } from './stored-chapters';

describe('stored chapter ids', () => {
  const bible = (lang: string, narrators: BibleCatalogEntry['narrators']): BibleCatalogEntry =>
    ({ lang, version: 'otb', flag: '', label: lang, narrators });

  beforeEach(() => {
    resetCatalog();
    setCatalog([
      bible('pt', [
        { id: 'ariel', label: 'Ariel', chapterRev: { GEN: { '1': 2 }, JON: { '1': 3 } } },
        { id: 'lucas', label: 'Lucas' },
      ]),
      bible('es', [
        { id: 'ariel', label: 'Ariel', chapterRev: { JHN: { '3': 4 } } },
      ]),
    ]);
  });
  afterEach(() => resetCatalog());

  it('splits a narrator id and a default-voice id', () => {
    expect(parseStoredChapterId('otb-ariel-Gn-1')).toEqual({
      version: 'otb', narratorId: 'ariel', abbrev: 'Gn', chapter: 1,
    });
    expect(parseStoredChapterId('otb-Gn-1')).toEqual({ version: 'otb', abbrev: 'Gn', chapter: 1 });
    expect(parseStoredChapterId('otb-ariel-Gn')).toBeNull();
    expect(parseStoredChapterId('otb-ariel-Gn-0')).toBeNull();
  });

  it('maps the language abbreviation to the CDN book and keeps a chapter revision above 1', () => {
    const track = trackForStoredId('otb-ariel-Gn-1');
    expect(track?.bookIdx).toBe(0);
    expect(track?.rev).toBe(2);
    expect(track?.url).toContain('/audios/pt/OTB/GEN/GEN 1.mp3');
    expect(track?.url).not.toContain('/ariel/');
  });

  it('keeps an English abbreviation that has a space', () => {
    setCatalog([bible('en', [{ id: 'ariel', label: 'Ariel', chapterRev: { '1SA': { '3': 2 } } }])]);
    const track = trackForStoredId('otb-ariel-1 Sam-3');
    expect(track?.bookIdx).toBe(8);
    expect(track?.url).toContain('/audios/en/OTB/1SA/1SA 3.mp3');
  });

  it('uses Jonah for Portuguese Jn and John for Spanish Jn, and skips the id when both could own it', () => {
    expect(trackForStoredId('otb-lucas-Jn-1')?.bookIdx).toBe(31);
    expect(trackForStoredId('otb-lucas-Jn-1')?.url).toContain('/JON/JON 1.mp3');
    setCatalog([bible('es', [{ id: 'voz', label: 'Voz', chapterRev: { JHN: { '3': 4 } } }])]);
    expect(trackForStoredId('otb-voz-Jn-3')?.bookIdx).toBe(42);
    expect(trackForStoredId('otb-voz-Jn-3')?.url).toContain('/JHN/JHN 3.mp3');

    setCatalog([
      bible('pt', [{ id: 'ariel', label: 'Ariel' }]),
      bible('es', [{ id: 'ariel', label: 'Ariel' }]),
    ]);
    expect(trackForStoredId('otb-ariel-Jn-1')).toBeNull();
  });

  it('returns only stored chapters the catalog has republished', () => {
    expect(tracksForStoredIds(['otb-ariel-Gn-1', 'otb-lucas-Gn-1', 'nota']).map(t => t.id))
      .toEqual(['otb-ariel-Gn-1']);
  });
});
