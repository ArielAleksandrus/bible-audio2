/**
 * The list of Bibles this app offers.
 *
 * The CDN (Cloudflare R2, public bucket) cannot list directories, so nothing
 * is discovered by looking at folders: a version or a narrator exists for the
 * app once it is written down in a list. There are two copies of that list:
 *
 * - BUNDLED_CATALOG, below: what ships inside the app. It is the starting
 *   point, and all a device has until it has been online once.
 * - catalog.json at the root of the CDN: the same list, edited there. The app
 *   reads it whenever it opens with a connection (CatalogService), keeps the
 *   last valid copy on the device and uses it from then on. So a new version
 *   or narrator needs no app update at all: upload the files, edit the JSON.
 *
 * A new LANGUAGE is the exception: the interface texts of each language
 * (public/assets/i18n) ship inside the app, so a language the app has no
 * texts for (see UI_LANGUAGES) is left out of the list until an app update
 * brings them.
 *
 * What an entry stands for on the CDN:
 *
 *   text    jsons/{lang}-{version}.json
 *   audio   audios/{lang}/{VERSION}/{ISO}/{ISO} {chapter}.mp3            (0 or 1 narrator)
 *           audios/{lang}/{VERSION}/{narratorId}/{ISO}/{ISO} {chapter}.mp3  (2 or more)
 *   sample  audios/{lang}/{VERSION}/{narratorId}/sample.mp3   (optional, 2 or more narrators)
 *
 * A narrator belongs to a version. Each voice is a separate set of files on
 * the CDN and on the device, and the full-Bible download asks which one when
 * there are two or more. README, "Versions and narrators: where the files
 * go", has the whole picture.
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

/** Languages the interface has texts for (public/assets/i18n/{lang}.json). */
export const UI_LANGUAGES: readonly string[] = ['pt', 'en', 'es', 'zh', 'ja'];

/** What ships inside the app. catalog.json on the CDN starts as a copy of this. */
export const BUNDLED_CATALOG: readonly BibleCatalogEntry[] = [
  { lang: 'pt', version: 'ara', flag: '🇧🇷', label: 'Português - ARA' },
  { lang: 'en', version: 'niv', flag: '🇺🇸', label: 'English - NIV' },
  { lang: 'es', version: 'nvi', flag: '🇪🇸', label: 'Español - NVI' },
  { lang: 'zh', version: 'cnvs', flag: '🇨🇳', label: 'Chinese - CNVS (简体)' },
  { lang: 'ja', version: 'jcb', flag: '🇯🇵', label: '日本語 - JCB' },
];

// ---- the list in use ----

const STORAGE_KEY = 'bibleCatalog';

/** The list in use: the last valid catalog.json this device has seen, or the bundled one. */
export function currentCatalog(): readonly BibleCatalogEntry[] {
  return active;
}

/** Use this list from now on and keep it on the device. */
export function setCatalog(entries: readonly BibleCatalogEntry[]): void {
  active = entries;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bibles: entries }));
  } catch {
    // No storage (private mode, quota): the list still holds for this session.
  }
}

/** Back to the bundled list, forgetting the saved one (tests). */
export function resetCatalog(): void {
  active = BUNDLED_CATALOG;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing saved */ }
}

function savedCatalog(): BibleCatalogEntry[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseCatalog(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const LANG = /^[a-z]{2,3}$/;
const VERSION = /^[a-z0-9]+$/;
const NARRATOR_ID = /^[a-z0-9][a-z0-9_-]*$/;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

// Read once, when the app starts — after the constants above, which reading a saved list needs.
let active: readonly BibleCatalogEntry[] = savedCatalog() ?? BUNDLED_CATALOG;

/**
 * Reads the contents of a catalog.json: `{ "bibles": [ entry, … ] }`, entries
 * shaped like BUNDLED_CATALOG's. Returns null — and the app keeps the list it
 * has — when anything in it is malformed or repeated, because a half-read
 * list could silently change a language's default version or a version's
 * default voice. Entries in a language the interface has no texts for are
 * left out, which is not an error.
 */
export function parseCatalog(raw: unknown): BibleCatalogEntry[] | null {
  const list = (raw as { bibles?: unknown } | null)?.bibles;
  if (!Array.isArray(list)) return null;

  const entries: BibleCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') return null;
    const { lang, version, label, flag, narrators } = item as Record<string, unknown>;
    if (typeof lang !== 'string' || !LANG.test(lang)) return null;
    if (typeof version !== 'string' || !VERSION.test(version)) return null;
    if (!text(label)) return null;
    if (flag !== undefined && typeof flag !== 'string') return null;
    if (seen.has(`${lang}-${version}`)) return null;
    seen.add(`${lang}-${version}`);

    const entry: BibleCatalogEntry = { lang, version, flag: flag ?? '', label };
    if (narrators !== undefined) {
      if (!Array.isArray(narrators)) return null;
      const ids = new Set<string>();
      const voices: BibleNarrator[] = [];
      for (const n of narrators) {
        const { id, label: name } = (n ?? {}) as Record<string, unknown>;
        if (typeof id !== 'string' || !NARRATOR_ID.test(id) || !text(name) || ids.has(id)) return null;
        ids.add(id);
        voices.push({ id, label: name });
      }
      if (voices.length) entry.narrators = voices;
    }
    if (UI_LANGUAGES.includes(lang)) entries.push(entry);
  }
  return entries.length ? entries : null;
}

/**
 * A list read from the CDN, ready to replace the one in use: the version this
 * device has selected stays available even if the new list dropped it (its
 * text is on the device, and so may be its audio), added after the others so
 * it never becomes a default it was not.
 */
export function withSelectedKept(
  remote: BibleCatalogEntry[], previous: readonly BibleCatalogEntry[], selected: string | null,
): BibleCatalogEntry[] {
  if (!selected) return remote;
  const is = (e: BibleCatalogEntry) => `${e.lang}-${e.version}` === selected.toLowerCase();
  if (remote.some(is)) return remote;
  const kept = previous.find(is);
  return kept ? [...remote, kept] : remote;
}

export function catalogEntry(lang: string, version: string): BibleCatalogEntry | undefined {
  const l = baseLang(lang);
  const v = version.toLowerCase();
  return active.find(e => e.lang === l && e.version === v);
}

/** Every version offered for a language, default first. */
export function versionsForLanguage(lang: string): BibleCatalogEntry[] {
  const l = baseLang(lang);
  return active.filter(e => e.lang === l);
}

/** One entry per language (its default version), in catalog order. */
export function languageOptions(): BibleCatalogEntry[] {
  const seen = new Set<string>();
  return active.filter(e => !seen.has(e.lang) && !!seen.add(e.lang));
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
