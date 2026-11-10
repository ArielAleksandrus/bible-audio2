/**
 * The one list of Bibles this app offers.
 *
 * The CDN (Cloudflare R2, public bucket) cannot list directories, so nothing
 * here is discovered at runtime: an entry exists because someone uploaded its
 * files and then wrote it down in this file. The language picker, the version
 * switch and the audio URLs all read from here.
 *
 * What an entry stands for on the CDN:
 *
 *   text   jsons/{lang}-{version}.json
 *   audio  audios/{lang}/{VERSION}/{ISO}/{ISO} {chapter}.mp3            (0 or 1 narrator)
 *          audios/{lang}/{VERSION}/{narratorId}/{ISO}/{ISO} {chapter}.mp3  (2 or more)
 *
 * Order matters twice:
 * - the first entry of a language is that language's default (what the
 *   language picker offers on first run);
 * - the first narrator of a version is its default voice.
 */
export interface BibleNarrator {
  /** Folder name on the CDN and part of the download key. Lowercase ASCII, no spaces. */
  id: string;
  /** Shown to the user as is (a person's name, not translated). */
  label: string;
}

export interface BibleCatalogEntry {
  lang: string;
  version: string;
  label: string;
  flag: string;
  narrators?: BibleNarrator[];
}

export const BIBLE_CATALOG: readonly BibleCatalogEntry[] = [
  { lang: 'pt', version: 'ara', flag: '🇧🇷', label: 'Português - ARA' },
  { lang: 'en', version: 'niv', flag: '🇺🇸', label: 'English - NIV' },
  { lang: 'es', version: 'nvi', flag: '🇪🇸', label: 'Español - NVI' },
  { lang: 'zh', version: 'cnvs', flag: '🇨🇳', label: 'Chinese - CNVS (简体)' },
  { lang: 'ja', version: 'jcb', flag: '🇯🇵', label: '日本語 - JCB' },

  // How to add the owner's own narration (not active yet).
  //
  // 1. Upload jsons/pt-otb.json and audios/pt/OTB/{ISO}/{ISO} {n}.mp3, then add
  //    the entry AFTER pt/ara so ARA stays the Portuguese default:
  //
  //      { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB',
  //        narrators: [{ id: 'ariel', label: 'Ariel' }] },
  //
  //    With a single narrator the audio path has no narrator folder.
  //
  // 2. When a second voice is recorded, move (or copy) the first narrator's
  //    files into audios/pt/OTB/ariel/…, upload the new ones to
  //    audios/pt/OTB/{id}/… and list both:
  //
  //      narrators: [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana' }],
  //
  //    Keep the original narrator FIRST: chapters people downloaded before the
  //    second voice existed are his, and are only reused for the first one.
];

export function catalogEntry(lang: string, version: string): BibleCatalogEntry | undefined {
  const l = baseLang(lang);
  const v = version.toLowerCase();
  return BIBLE_CATALOG.find(e => e.lang === l && e.version === v);
}

/** Every version offered for a language, default first. */
export function versionsForLanguage(lang: string): BibleCatalogEntry[] {
  const l = baseLang(lang);
  return BIBLE_CATALOG.filter(e => e.lang === l);
}

/** One entry per language (its default version), in catalog order. */
export function languageOptions(): BibleCatalogEntry[] {
  const seen = new Set<string>();
  return BIBLE_CATALOG.filter(e => !seen.has(e.lang) && !!seen.add(e.lang));
}

export function isDefaultVersion(lang: string, version: string): boolean {
  return versionsForLanguage(lang)[0]?.version === version.toLowerCase();
}

/** Narrators the user can choose between: empty unless the version declares two or more. */
export function narratorChoices(entry: BibleCatalogEntry | undefined): BibleNarrator[] {
  const narrators = entry?.narrators ?? [];
  return narrators.length > 1 ? narrators : [];
}

/** 'pt-br' → 'pt'. Bible JSONs carry a regional language, the catalog and CDN don't. */
export function baseLang(lang: string): string {
  return lang.split('-')[0].toLowerCase();
}
