import { Track } from '../models/track';
import { audioUrl, BIBLE_ABBREV_ISO } from '../services/bible.service';
import { audioRev, baseLang, currentCatalog } from './bible-catalog';
import { BOOK_ABBREVS } from './book-abbrevs';

/** A downloaded chapter id, split. `otb-ariel-Gn-1` or `otb-Gn-1` (the default voice). */
export function parseStoredChapterId(id: string): { version: string; narratorId?: string; abbrev: string; chapter: number } | null {
  const parts = id.split('-');
  if (parts.length < 3 || parts.length > 4) return null;
  const chapter = Number(parts[parts.length - 1]);
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  const abbrev = parts[parts.length - 2];
  if (!abbrev) return null;
  if (parts.length === 3) return { version: parts[0], abbrev, chapter };
  return { version: parts[0], narratorId: parts[1], abbrev, chapter };
}

function bookIndex(lang: string, abbrev: string): number {
  const list = BOOK_ABBREVS[baseLang(lang)];
  const at = list?.findIndex(a => a.toLowerCase() === abbrev.toLowerCase()) ?? -1;
  if (at >= 0) return at;
  return BIBLE_ABBREV_ISO.findIndex(iso => iso.toLowerCase() === abbrev.toLowerCase());
}

/**
 * The catalog track for a file already on the device, or null when the id
 * is not a chapter or more than one Bible could own it.
 */
export function trackForStoredId(id: string): Track | null {
  const parsed = parseStoredChapterId(id);
  if (!parsed) return null;
  const matches = currentCatalog().filter(entry => {
    if (entry.version !== parsed.version.toLowerCase()) return false;
    if (bookIndex(entry.lang, parsed.abbrev) < 0) return false;
    if (!parsed.narratorId) return true;
    return (entry.narrators ?? []).some(n => n.id === parsed.narratorId);
  });
  if (matches.length !== 1) return null;
  const entry = matches[0];
  const idx = bookIndex(entry.lang, parsed.abbrev);
  const iso = BIBLE_ABBREV_ISO[idx];
  const rev = audioRev(entry, parsed.narratorId, iso, parsed.chapter);
  return {
    id,
    book: parsed.abbrev,
    chapter: parsed.chapter,
    title: `${parsed.abbrev} ${parsed.chapter}`,
    fileName: '',
    url: audioUrl(entry.lang, entry.version, idx, parsed.chapter, parsed.narratorId),
    status: 'pending',
    lang: entry.lang,
    version: entry.version,
    bookIdx: idx,
    abbrev: parsed.abbrev,
    narrator: parsed.narratorId,
    ...(rev > 1 ? { rev } : {}),
  };
}

/** One track per stored id that belongs to a single Bible. */
export function tracksForStoredIds(ids: readonly string[]): Track[] {
  return ids.map(trackForStoredId).filter((t): t is Track => t !== null && (t.rev ?? 1) > 1);
}
