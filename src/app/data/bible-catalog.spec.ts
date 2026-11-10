import { BIBLE_CATALOG, catalogEntry, languageOptions, narratorChoices, versionsForLanguage } from './bible-catalog';
import { audioUrl, retargetTracks, trackId } from '../services/bible.service';
import { Track } from '../models/track';

describe('bible catalog', () => {
  it('offers exactly the five versions the app has always had, in the same order', () => {
    expect(BIBLE_CATALOG.map(e => `${e.lang}-${e.version}`)).toEqual(['pt-ara', 'en-niv', 'es-nvi', 'zh-cnvs', 'ja-jcb']);
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
