import {
  audioFormatFor, BibleCatalogEntry, BUNDLED_CATALOG, catalogEntry, currentCatalog, defaultNarrator, hasNameOnlyKeys,
  languageOptions, narratorChoices, parseCatalog, resetCatalog, setCatalog, setFormatSupport, versionsForLanguage,
  withSelectedKept,
} from './bible-catalog';
import { audioUrl, retargetTracks, sampleUrl, trackId } from '../services/bible.service';
import { Track } from '../models/track';
import { FIVE_LICENSED as FIVE } from '../../testing/bible-catalog';


describe('bible catalog', () => {
  beforeEach(() => resetCatalog());
  afterEach(() => resetCatalog());

  it('ships with OTB in Portuguese only, read by Ariel, its default voice', () => {
    expect(BUNDLED_CATALOG.map(e => `${e.lang}-${e.version}`)).toEqual(['pt-otb']);
    expect(languageOptions().map(o => o.name)).toEqual(['Português']);
    expect(defaultNarrator(catalogEntry('pt', 'otb'))).toBe('ariel');
  });

  it('finds a version by the regional language a Bible JSON carries', () => {
    setCatalog(FIVE);
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
    setCatalog(parseCatalog({ bibles: [...FIVE, otb] })!);
    expect(versionsForLanguage('pt-br').map(e => e.version)).toEqual(['ara', 'otb']);
    expect(narratorChoices(catalogEntry('pt', 'otb')).map(n => n.id)).toEqual(['ariel', 'ana']);
    expect(languageOptions().map(o => o.lang)).toEqual(['pt', 'en', 'es', 'zh', 'ja']);
    expect(languageOptions()[0].versions.map(v => v.version)).toEqual(['ara', 'otb']);
    expect(parseCatalog(JSON.parse(localStorage.getItem('bibleCatalog')!))).toEqual(currentCatalog());
  });

  it('starts from the list saved on the device the next time the app opens', async () => {
    setCatalog(parseCatalog({ bibles: [...FIVE, otb] })!);
    vi.resetModules();
    const reopened = await import('./bible-catalog');
    expect(reopened.versionsForLanguage('pt').map(e => e.version)).toEqual(['ara', 'otb']);
  });

  it('leaves out a language the interface has no texts for', () => {
    const fr = { lang: 'fr', version: 'lsg', flag: '🇫🇷', label: 'Français - LSG' };
    expect(parseCatalog({ bibles: [...FIVE, fr] })).toEqual(FIVE);
    expect(parseCatalog({ bibles: [fr] })).toBeNull();
  });

  it('rejects the whole list when anything in it is malformed or repeated', () => {
    const bad = (extra: unknown) => parseCatalog({ bibles: [...FIVE, extra] });
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
    expect(bad(FIVE[0])).toBeNull();
    expect(bad({ ...otb, hidden: 'true' })).toBeNull();
    expect(bad({ ...otb, hidden: 1 })).toBeNull();
    expect(bad({ ...otb, hidden: null })).toBeNull();
  });

  it('keeps the version this device has selected when the new list dropped it', () => {
    const previous = [...FIVE, otb];
    const remote = [...FIVE];
    expect(withSelectedKept(remote, previous, 'pt-otb').map(e => e.version)).toEqual(['ara', 'niv', 'nvi', 'cnvs', 'jcb', 'otb']);
    expect(withSelectedKept(remote, previous, 'pt-ara')).toBe(remote);
    expect(withSelectedKept(remote, previous, null)).toBe(remote);
    expect(withSelectedKept(remote, previous, 'pt-xyz')).toBe(remote);
  });
});

describe('hidden versions', () => {
  beforeEach(() => resetCatalog());
  afterEach(() => resetCatalog());

  const otb = { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB' };
  const ara = FIVE[0];
  const others = FIVE.slice(1);

  it('reads hidden only as a boolean, and keeps it only when true', () => {
    expect(parseCatalog({ bibles: [ara, { ...otb, hidden: true }] })![1].hidden).toBe(true);
    expect(parseCatalog({ bibles: [ara, { ...otb, hidden: false }] })![1]).toEqual(otb);
  });

  it('offers a hidden version nowhere, but still finds it for a device that has it selected', () => {
    setCatalog(parseCatalog({ bibles: [ara, { ...otb, hidden: true }, ...others] })!);
    expect(versionsForLanguage('pt').map(e => e.version)).toEqual(['ara']);
    expect(languageOptions()[0].versions.map(v => v.version)).toEqual(['ara']);
    expect(catalogEntry('pt', 'otb')?.label).toBe('Português - OTB');
  });

  it('makes the first version that is not hidden the default', () => {
    setCatalog(parseCatalog({ bibles: [{ ...ara, hidden: true }, otb, ...others] })!);
    expect(versionsForLanguage('pt')[0].version).toBe('otb');
    expect(languageOptions()[0]).toMatchObject({ lang: 'pt', name: 'Português', versions: [otb] });
  });

  it('does not offer a language whose versions are all hidden', () => {
    setCatalog(parseCatalog({ bibles: [{ ...ara, hidden: true }, { ...otb, hidden: true }, ...others] })!);
    expect(languageOptions().map(o => o.lang)).toEqual(['en', 'es', 'zh', 'ja']);
    expect(versionsForLanguage('pt')).toEqual([]);
  });

  it('keeps old name-only storage keys with the five original versions, whatever the list says', () => {
    setCatalog(parseCatalog({ bibles: [{ ...ara, hidden: true }, otb, ...others] })!);
    expect(hasNameOnlyKeys('pt-br', 'ara')).toBe(true);
    expect(hasNameOnlyKeys('pt', 'otb')).toBe(false);
    resetCatalog(); // OTB the default, ARA gone from the list
    expect(hasNameOnlyKeys('pt', 'otb')).toBe(false);
    expect(hasNameOnlyKeys('pt', 'ara')).toBe(true);
    expect(hasNameOnlyKeys('ja', 'jcb')).toBe(true);
  });

  it('keeps a hidden version selected on this device when the new list drops it', () => {
    const previous = [ara, { ...otb, hidden: true }, ...others];
    const kept = withSelectedKept([...FIVE], previous, 'pt-otb');
    expect(kept.at(-1)).toEqual({ ...otb, hidden: true });
  });
});

describe('audio URL and storage key', () => {
  const CDN = 'https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev';
  const otb: BibleCatalogEntry = {
    lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB',
    narrators: [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana' }], formats: ['opus', 'mp3'],
  };

  beforeEach(() => {
    setCatalog([...FIVE, otb]);
    setFormatSupport('opus', true);
  });
  afterEach(() => {
    resetCatalog();
    setFormatSupport('opus', undefined);
  });

  it('keeps today\'s URL and key for a version with no narrators or formats', () => {
    expect(audioUrl('pt-br', 'ara', 0, 1)).toBe(`${CDN}/audios/pt/ARA/GEN/GEN 1.mp3`);
    expect(audioUrl('en', 'niv', 18, 23)).toBe(`${CDN}/audios/en/NIV/PSA/PSA 23.mp3`);
    expect(trackId('ara', 'Gn', 1)).toBe('ara-Gn-1');
  });

  it('gives the default voice no folder, and every other voice its own', () => {
    expect(audioUrl('pt', 'otb', 65, 22, 'ariel')).toBe(`${CDN}/audios/pt/OTB/REV/REV 22.m4a`);
    expect(audioUrl('pt', 'otb', 65, 22)).toBe(`${CDN}/audios/pt/OTB/REV/REV 22.m4a`);
    expect(audioUrl('pt', 'otb', 65, 22, 'ana')).toBe(`${CDN}/audios/pt/OTB/ana/REV/REV 22.m4a`);
    expect(sampleUrl('pt', 'otb', 'ariel')).toBe(`${CDN}/audios/pt/OTB/sample.mp3`);
    expect(sampleUrl('pt', 'otb', 'ana')).toBe(`${CDN}/audios/pt/OTB/ana/sample.mp3`);
  });

  it('keeps the narrator in the key, so two voices never share a file', () => {
    expect(trackId('otb', 'Ap', 22, 'ariel')).toBe('otb-ariel-Ap-22');
    expect(trackId('otb', 'Ap', 22, 'ana')).not.toBe(trackId('otb', 'Ap', 22, 'ariel'));
  });

  it('downloads the first format this device plays, and mp3 when it plays none of the others', () => {
    expect(audioFormatFor(otb)).toBe('opus');
    setFormatSupport('opus', false);
    expect(audioFormatFor(otb)).toBe('mp3');
    expect(audioUrl('pt', 'otb', 0, 1, 'ana')).toBe(`${CDN}/audios/pt/OTB/ana/GEN/GEN 1.mp3`);
    expect(audioFormatFor(undefined)).toBe('mp3');
    expect(audioFormatFor(FIVE[0])).toBe('mp3');
  });

  it('rebuilds a playlist for another narrator without changing which chapters it holds', () => {
    const t: Track = {
      id: 'otb-ariel-Gn-1', book: 'Gênesis', chapter: 1, title: 'Gênesis 1', fileName: 'otb-Gn-1',
      url: audioUrl('pt', 'otb', 0, 1, 'ariel'), status: 'done',
      lang: 'pt', version: 'otb', bookIdx: 0, abbrev: 'Gn', narrator: 'ariel',
    };
    const [ana] = retargetTracks([t], 'ana');
    expect(ana.id).toBe('otb-ana-Gn-1');
    expect(ana.url).toBe(`${CDN}/audios/pt/OTB/ana/GEN/GEN 1.m4a`);
    expect(ana.fileName).toBe(''); // another voice must never reuse the first one's file
    expect(ana.title).toBe('Gênesis 1');
    expect(ana.status).toBe('pending');
    const [back] = retargetTracks([ana], 'ariel');
    expect(back.url).toBe(`${CDN}/audios/pt/OTB/GEN/GEN 1.m4a`);
    expect(back.fileName).toBe('otb-Gn-1');
  });
});

describe('formats in catalog.json', () => {
  afterEach(() => resetCatalog());
  const otb = { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB' };

  it('keeps the formats it knows, in order, and drops a plain ["mp3"]', () => {
    expect(parseCatalog({ bibles: [{ ...otb, formats: ['opus', 'mp3'] }] })![0].formats).toEqual(['opus', 'mp3']);
    expect(parseCatalog({ bibles: [{ ...otb, formats: ['mp3'] }] })![0]).toEqual(otb);
  });

  it('skips a format a newer catalog adds, and leaves out an entry it cannot play at all', () => {
    expect(parseCatalog({ bibles: [{ ...otb, formats: ['flac', 'opus', 'mp3'] }] })![0].formats).toEqual(['opus', 'mp3']);
    expect(parseCatalog({ bibles: [FIVE[0], { ...otb, formats: ['flac'] }] })).toEqual([FIVE[0]]);
  });

  it('rejects the whole list when formats is malformed or repeated', () => {
    const bad = (formats: unknown) => parseCatalog({ bibles: [FIVE[0], { ...otb, formats }] });
    expect(bad('opus')).toBeNull();
    expect(bad([])).toBeNull();
    expect(bad([1])).toBeNull();
    expect(bad(['opus', 'opus'])).toBeNull();
  });
});
