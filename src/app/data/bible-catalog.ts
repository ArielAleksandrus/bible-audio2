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
 *   audio   audios/{lang}/{VERSION}/{ISO}/{ISO} {chapter}.{ext}               (default voice)
 *           audios/{lang}/{VERSION}/{narratorId}/{ISO}/{ISO} {chapter}.{ext}  (any other voice)
 *   sample  audios/{lang}/{VERSION}/sample.mp3                (optional, default voice)
 *           audios/{lang}/{VERSION}/{narratorId}/sample.mp3   (optional, any other voice)
 *
 * A narrator belongs to a version. Each voice is a separate set of files on
 * the CDN and on the device, and the full-Bible download asks which one when
 * there are two or more. The default voice (the first narrator, or the only
 * one) has no folder of its own, so giving a version a second voice moves
 * nothing that is already there.
 *
 * {ext} comes from the entry's `formats` (AUDIO_FORMATS): the first one this
 * device can play. Without `formats` it is mp3, as it always was. Every
 * format listed must exist for every chapter, side by side, same name.
 *
 * README, "Versions and narrators: where the files go", has the whole picture.
 *
 * Order matters twice:
 * - the first entry of a language that is not hidden is that language's
 *   default (listed first when the language picker asks for a version);
 * - the first narrator of a version is its default voice.
 *
 * An entry with `hidden: true` is offered nowhere (language picker, Home,
 * Settings), but a device that already has it selected keeps using it. A
 * language whose entries are all hidden is not offered.
 */
export interface BibleNarrator {
  /** Folder name on the CDN and part of the download key. Lowercase ASCII, no spaces. */
  id: string;
  /** Shown to the user as is (a person's name, not translated). */
  label: string;
  /**
   * The books this voice has so far, by ISO code ('GEN', 'LEV'), while the
   * narration is being made. Absent = every book. Only these are downloaded
   * and count for "complete"; the others are marked as not available yet.
   */
  books?: string[];
  /** Size of the whole voice on the CDN, in bytes, per format; shown before a download. Absent = estimated. */
  bytes?: Partial<Record<AudioFormat, number>>;
  /**
   * Revision of each book's audio, by ISO code, for the books whose files
   * were replaced on the CDN after they were first published (e.g. silence
   * added at the start). A book that is not listed is at revision 1. A
   * chapter downloaded at a lower revision keeps playing, and the new file
   * is fetched in the background to replace it (AudioDownloaderService).
   */
  rev?: Record<string, number>;
}

/**
 * Audio formats a version can be offered in, with the file extension on the
 * CDN and on the device.
 * 'opus' is Opus in an MP4 container (.m4a): about a quarter of a 128 kbps
 * MP3 for the same voice, but not every device plays it (older iPhones).
 */
export const AUDIO_FORMATS = {
  opus: { ext: 'm4a' },
  mp3: { ext: 'mp3' },
} as const;

export type AudioFormat = keyof typeof AUDIO_FORMATS;

export interface BibleCatalogEntry {
  lang: string;
  version: string;
  label: string;
  flag: string;
  narrators?: BibleNarrator[];
  /** Best first; the device uses the first one it can play. Absent = ['mp3']. */
  formats?: AudioFormat[];
  /** Not offered for choosing; still opens on a device that already has it selected. */
  hidden?: boolean;
}

/** One language in the language picker, with the versions it offers (default first, never empty). */
export interface LanguageOption {
  lang: string;
  /** The language's own name, e.g. 'Português'. */
  name: string;
  flag: string;
  versions: BibleCatalogEntry[];
}

/** Languages the interface has texts for (public/assets/i18n/{lang}.json). */
export const UI_LANGUAGES: readonly string[] = ['pt', 'en', 'es', 'zh', 'ja'];

/** How each of UI_LANGUAGES is named in the language picker, in that language. */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
  zh: '中文',
  ja: '日本語',
};

/** What ships inside the app. catalog.json on the CDN starts as a copy of this. */
export const BUNDLED_CATALOG: readonly BibleCatalogEntry[] = [
  {
    lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB',
    narrators: [{ id: 'ariel', label: 'Ariel' }], formats: ['opus', 'mp3'],
  },
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
const BOOK_ISO = /^[1-3]?[A-Z]{2,3}$/;
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
    const { lang, version, label, flag, narrators, hidden, formats } = item as Record<string, unknown>;
    if (typeof lang !== 'string' || !LANG.test(lang)) return null;
    if (typeof version !== 'string' || !VERSION.test(version)) return null;
    if (!text(label)) return null;
    if (flag !== undefined && typeof flag !== 'string') return null;
    if (hidden !== undefined && typeof hidden !== 'boolean') return null;
    if (seen.has(`${lang}-${version}`)) return null;
    seen.add(`${lang}-${version}`);

    const entry: BibleCatalogEntry = { lang, version, flag: flag ?? '', label };
    if (narrators !== undefined) {
      if (!Array.isArray(narrators)) return null;
      const ids = new Set<string>();
      const voices: BibleNarrator[] = [];
      for (const n of narrators) {
        const { id, label: name, books, bytes, rev } = (n ?? {}) as Record<string, unknown>;
        if (typeof id !== 'string' || !NARRATOR_ID.test(id) || !text(name) || ids.has(id)) return null;
        ids.add(id);
        const voice: BibleNarrator = { id, label: name };
        if (books !== undefined) {
          if (!Array.isArray(books) || books.some(b => typeof b !== 'string' || !BOOK_ISO.test(b))) return null;
          voice.books = [...new Set(books as string[])];
        }
        if (bytes !== undefined) {
          if (!bytes || typeof bytes !== 'object' || Array.isArray(bytes)) return null;
          const sizes: Partial<Record<AudioFormat, number>> = {};
          for (const [format, size] of Object.entries(bytes)) {
            if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
            if (Object.hasOwn(AUDIO_FORMATS, format)) sizes[format as AudioFormat] = size;
          }
          voice.bytes = sizes;
        }
        if (rev !== undefined) {
          if (!rev || typeof rev !== 'object' || Array.isArray(rev)) return null;
          const revs: Record<string, number> = {};
          for (const [iso, r] of Object.entries(rev)) {
            if (!BOOK_ISO.test(iso) || typeof r !== 'number' || !Number.isInteger(r) || r < 1) return null;
            if (r > 1) revs[iso] = r;
          }
          if (Object.keys(revs).length) voice.rev = revs;
        }
        voices.push(voice);
      }
      if (voices.length) entry.narrators = voices;
    }
    if (formats !== undefined) {
      if (!Array.isArray(formats) || !formats.length || formats.some(f => typeof f !== 'string')) return null;
      if (new Set(formats).size !== formats.length) return null;
      // A format a newer catalog may add is skipped, not an error; an entry
      // left with none this app knows can't be played here, so it's left out.
      const known = formats.filter((f): f is AudioFormat => Object.hasOwn(AUDIO_FORMATS, f));
      if (!known.length) continue;
      if (known.length !== 1 || known[0] !== 'mp3') entry.formats = known;
    }
    if (hidden) entry.hidden = true;
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

/** Every version offered for a language (hidden ones left out), default first. */
export function versionsForLanguage(lang: string): BibleCatalogEntry[] {
  const l = baseLang(lang);
  return active.filter(e => e.lang === l && !e.hidden);
}

/** The languages offered, in catalog order: those with at least one version that is not hidden. */
export function languageOptions(): LanguageOption[] {
  const options: LanguageOption[] = [];
  for (const e of active) {
    if (e.hidden || options.some(o => o.lang === e.lang)) continue;
    options.push({ lang: e.lang, name: LANGUAGE_NAMES[e.lang] ?? e.lang, flag: e.flag, versions: versionsForLanguage(e.lang) });
  }
  return options;
}

/**
 * The versions that existed before chapters were saved under ids, one per
 * language: a chapter saved under the old name-only key ("Gênesis 1.mp3")
 * can only be theirs. A fixed list, not the catalog's order, so a version
 * that becomes a language's default later (or the removal of these) never
 * plays someone else's audio.
 */
const NAME_KEY_VERSIONS: readonly string[] = ['pt-ara', 'en-niv', 'es-nvi', 'zh-cnvs', 'ja-jcb'];

/** Whether chapters of this version may be saved under the old name-only key. Only for BibleService.buildTrack. */
export function hasNameOnlyKeys(lang: string, version: string): boolean {
  return NAME_KEY_VERSIONS.includes(`${baseLang(lang)}-${version.toLowerCase()}`);
}

/** Narrators the user can choose between: empty unless the version declares two or more. */
export function narratorChoices(entry: BibleCatalogEntry | undefined): BibleNarrator[] {
  const narrators = entry?.narrators ?? [];
  return narrators.length > 1 ? narrators : [];
}

/** A voice of a version: the narrator with this id, or the default one (first) when no id is given. */
export function narratorOf(entry: BibleCatalogEntry | undefined, narratorId?: string): BibleNarrator | undefined {
  const narrators = entry?.narrators ?? [];
  return narratorId ? narrators.find(n => n.id === narratorId) : narrators[0];
}

/** Whether a voice has this book yet (by ISO code). Without a `books` list, or without narrators at all, every book. */
export function voiceHasBook(entry: BibleCatalogEntry | undefined, narratorId: string | undefined, iso: string): boolean {
  const books = narratorOf(entry, narratorId)?.books;
  return !books || books.includes(iso.toUpperCase());
}

/** Revision of a book's audio in a voice (by ISO code): 1 unless the catalog says otherwise. */
export function audioRev(entry: BibleCatalogEntry | undefined, narratorId: string | undefined, iso: string): number {
  return narratorOf(entry, narratorId)?.rev?.[iso.toUpperCase()] ?? 1;
}

/** The id of a version's default voice: its first narrator, or undefined without any. */
export function defaultNarrator(entry: BibleCatalogEntry | undefined): string | undefined {
  return entry?.narrators?.[0]?.id;
}

const playable = new Map<AudioFormat, boolean>();

/**
 * Whether this device plays a format, as found out by playing it
 * (utils/audio-format-probe.ts) — never by asking canPlayType, which says no
 * on iPhones that play Opus. Not known yet = no: mp3 is the fallback, and it
 * plays everywhere.
 */
export function canPlayFormat(format: AudioFormat): boolean {
  return format === 'mp3' || playable.get(format) === true;
}

/** What the probe found out about a format; undefined forgets it (tests). */
export function setFormatSupport(format: AudioFormat, supported: boolean | undefined): void {
  if (supported === undefined) playable.delete(format);
  else playable.set(format, supported);
}

/** The format this device downloads a version in: the first of its formats it can play. */
export function audioFormatFor(entry: BibleCatalogEntry | undefined): AudioFormat {
  return entry?.formats?.find(canPlayFormat) ?? 'mp3';
}

/** 'pt-br' → 'pt'. Bible JSONs carry a regional language, the catalog and CDN don't. */
export function baseLang(lang: string): string {
  return lang.split('-')[0].toLowerCase();
}
