import {
  BUNDLED_CATALOG, catalogEntry, currentCatalog, languageOptions, narratorChoices, parseCatalog, resetCatalog,
  setCatalog, versionsForLanguage, withSelectedKept,
} from './bible-catalog';
import { audioUrl, retargetTracks, trackId } from '../services/bible.service';
import { Track } from '../models/track';

describe('bible catalog', () => {
  beforeEach(() => resetCatalog());
  afterEach(() => resetCatalog());

  it('offers exactly the five versions the app has always had, in the same order', () => {
    expect(BUNDLED_CATALOG.map(e => `${e.lang}-${e.version}`)).toEqual(['pt-ara', 'en-niv', 'es-nvi', 'zh-cnvs', 'ja-jcb']);
    expect(languageOptions().map(e => e.label)).toEqual([
      'Português - ARA', 'English - NIV', 'Español - NVI', 'Chinese - CNVS (简体)', '日本語 - JCB',
    ]);
  });

  it('finds a version by the regional language a Bible JSON carries', () => {
    expect(catalogEntry('pt-br', 'ara')?.label).toBe('Português - ARA');
    expect(versionsForLanguage('pt-br').map(e => e.version)).toEqual(['ara']);
    expect(catalogEntry('pt', 'otb')).toBeUndefined();
  });

  it('offers a narrator choice only with two or more narrators', () => {
    const base = { lang: 'pt', version: 'otb', label: 'x', flag: '' };
    expect(narratorChoices(undefined)).toEqual([]);
    expect(narratorChoices(base)).toEqual([]);
    expect(narratorChoices({ ...base, narrators: [{ id: 'ariel', label: 'Ariel' }] })).toEqual([]);
    expect(narratorChoices({ ...base, narrators: [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana' }] }).map(n => n.id))
      .toEqual(['ariel', 'ana']);
  });
});

describe('catalog.json from the CDN', () => {
  beforeEach(() => resetCatalog());
  afterEach(() => resetCatalog());

  const otb = { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB', narrators: [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana' }] };

  it('reads the bundled list back unchanged, so the first catalog.json can be a copy of it', () => {
    expect(parseCatalog(JSON.parse(JSON.stringify({ bibles: BUNDLED_CATALOG })))).toEqual(BUNDLED_CATALOG);
  });

  it('offers a new version and its narrators once the list is in use, and keeps it on the device', () => {
    setCatalog(parseCatalog({ bibles: [...BUNDLED_CATALOG, otb] })!);
    expect(versionsForLanguage('pt-br').map(e => e.version)).toEqual(['ara', 'otb']);
    expect(narratorChoices(catalogEntry('pt', 'otb')).map(n => n.id)).toEqual(['ariel', 'ana']);
    expect(languageOptions().map(e => e.version)).toEqual(['ara', 'niv', 'nvi', 'cnvs', 'jcb']);
    expect(parseCatalog(JSON.parse(localStorage.getItem('bibleCatalog')!))).toEqual(currentCatalog());
  });

  it('starts from the list saved on the device the next time the app opens', async () => {
    setCatalog(parseCatalog({ bibles: [...BUNDLED_CATALOG, otb] })!);
    vi.resetModules();
    const reopened = await import('./bible-catalog');
    expect(reopened.versionsForLanguage('pt').map(e => e.version)).toEqual(['ara', 'otb']);
  });

  it('leaves out a language the interface has no texts for', () => {
    const fr = { lang: 'fr', version: 'lsg', flag: '🇫🇷', label: 'Français - LSG' };
    expect(parseCatalog({ bibles: [...BUNDLED_CATALOG, fr] })).toEqual(BUNDLED_CATALOG);
    expect(parseCatalog({ bibles: [fr] })).toBeNull();
  });

  it('rejects the whole list when anything in it is malformed or repeated', () => {
    const bad = (extra: unknown) => parseCatalog({ bibles: [...BUNDLED_CATALOG, extra] });
    expect(parseCatalog(null)).toBeNull();
    expect(parseCatalog({})).toBeNull();
    expect(parseCatalog({ bibles: [] })).toBeNull();
    expect(bad('pt-otb')).toBeNull();
    expect(bad({ ...otb, lang: 'PT' })).toBeNull();
    expect(bad({ ...otb, version: 'O T B' })).toBeNull();
    expect(bad({ ...otb, label: '' })).toBeNull();
    expect(bad({ ...otb, narrators: 'ariel' })).toBeNull();
    expect(bad({ ...otb, narrators: [{ id: 'Ana Maria', label: 'Ana' }] })).toBeNull();
    expect(bad({ ...otb, narrators: [{ id: 'ana' }] })).toBeNull();
    expect(bad({ ...otb, narrators: [{ id: 'ana', label: 'Ana' }, { id: 'ana', label: 'Ana 2' }] })).toBeNull();
    expect(bad(BUNDLED_CATALOG[0])).toBeNull();
  });

  it('keeps the version this device has selected when the new list dropped it', () => {
    const previous = [...BUNDLED_CATALOG, otb];
    const remote = [...BUNDLED_CATALOG];
    expect(withSelectedKept(remote, previous, 'pt-otb').map(e => e.version)).toEqual(['ara', 'niv', 'nvi', 'cnvs', 'jcb', 'otb']);
    expect(withSelectedKept(remote, previous, 'pt-ara')).toBe(remote);
    expect(withSelectedKept(remote, previous, null)).toBe(remote);
    expect(withSelectedKept(remote, previous, 'pt-xyz')).toBe(remote);
  });
});

describe('audio URL and storage key', () => {
  const CDN = 'https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev';

  it('keeps today\'s URL and key when no narrator is involved', () => {
    expect(audioUrl('pt-br', 'ara', 0, 1)).toBe(`${CDN}/audios/pt/ARA/GEN/GEN 1.mp3`);
    expect(audioUrl('en', 'niv', 18, 23)).toBe(`${CDN}/audios/en/NIV/PSA/PSA 23.mp3`);
    expect(trackId('ara', 'Gn', 1)).toBe('ara-Gn-1');
  });

  it('adds the narrator to both the URL and the key', () => {
    expect(audioUrl('pt', 'otb', 65, 22, 'ariel')).toBe(`${CDN}/audios/pt/OTB/ariel/REV/REV 22.mp3`);
    expect(trackId('otb', 'Ap', 22, 'ariel')).toBe('otb-ariel-Ap-22');
    expect(trackId('otb', 'Ap', 22, 'ana')).not.toBe(trackId('otb', 'Ap', 22, 'ariel'));
  });

  it('rebuilds a playlist for another narrator without changing which chapters it holds', () => {
    const t: Track = {
      id: 'otb-ariel-Gn-1', book: 'Gênesis', chapter: 1, title: 'Gênesis 1', fileName: 'otb-Gn-1',
      url: audioUrl('pt', 'otb', 0, 1, 'ariel'), status: 'done',
      lang: 'pt', version: 'otb', bookIdx: 0, abbrev: 'Gn', narrator: 'ariel',
    };
    const [ana] = retargetTracks([t], 'ana');
    expect(ana.id).toBe('otb-ana-Gn-1');
    expect(ana.url).toBe(`${CDN}/audios/pt/OTB/ana/GEN/GEN 1.mp3`);
    expect(ana.fileName).toBe(''); // another voice must never reuse the first one's file
    expect(ana.title).toBe('Gênesis 1');
    expect(ana.status).toBe('pending');
  });
});
