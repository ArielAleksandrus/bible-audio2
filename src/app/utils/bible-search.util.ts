import { parseChapter } from './bible-text.util';

// Text search over the Bible JSON already on the device. No network, no
// remote index: the whole text is ~31,000 verses, which a linear scan of
// pre-folded strings covers in a few milliseconds.

interface BookLike {
  chapters: string[][];
}

export interface SearchHit {
  bookIdx: number;
  /** 1-based. */
  chapter: number;
  /** 1-based, numbered as the text viewer numbers verses (headings are skipped). */
  verse: number;
  /** Short excerpt around the match, split so the match itself can be marked. */
  before: string;
  match: string;
  after: string;
}

export interface SearchIndex {
  entries: { bookIdx: number; chapter: number; verse: number; text: string; folded: string }[];
}

const COMBINING_ACCENTS = /[̀-ͯ]/g;

/**
 * Lowercase and strip accents, so "coracao" finds "coração" and "jesus"
 * finds "Jesús". Only the Latin combining accents are removed: the marks
 * that kana decompose into (が → か + ゛) carry meaning and are kept.
 */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(COMBINING_ACCENTS, '').toLowerCase();
}

export function buildSearchIndex(books: BookLike[]): SearchIndex {
  const entries: SearchIndex['entries'] = [];
  books.forEach((book, bookIdx) => {
    book.chapters.forEach((raw, c) => {
      for (const entry of parseChapter(raw || [])) {
        if (entry.heading || !entry.verseNumber) continue;
        entries.push({ bookIdx, chapter: c + 1, verse: entry.verseNumber, text: entry.text, folded: foldText(entry.text) });
      }
    });
  });
  return { entries };
}

/** Shortest query worth running. Two characters is already a whole word in Chinese and Japanese. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Verses containing the query, in Bible order. `total` counts every match;
 * `hits` holds only the first `limit` of them.
 */
export function searchBible(index: SearchIndex, query: string, limit = 30): { hits: SearchHit[]; total: number } {
  const needle = foldText(query.trim()).replace(/\s+/g, ' ');
  if (needle.length < MIN_QUERY_LENGTH) return { hits: [], total: 0 };

  const hits: SearchHit[] = [];
  let total = 0;
  for (const e of index.entries) {
    if (!e.folded.includes(needle)) continue;
    total++;
    if (hits.length < limit) {
      hits.push({ bookIdx: e.bookIdx, chapter: e.chapter, verse: e.verse, ...excerpt(e.text, needle) });
    }
  }
  return { hits, total };
}

const CONTEXT_BEFORE = 30;
const EXCERPT_LENGTH = 110;

/** Cut a short excerpt of `text` around where the folded `needle` matches. */
export function excerpt(text: string, needle: string): { before: string; match: string; after: string } {
  // Folding can change a string's length (é → e + accent → e), so positions
  // in the folded text are mapped back through each original character.
  const starts: number[] = []; // starts[i] = index in `text` of the char that produced folded char i
  let folded = '';
  for (let i = 0; i < text.length; i++) {
    const f = foldText(text[i]);
    for (let k = 0; k < f.length; k++) starts.push(i);
    folded += f;
  }

  const at = folded.indexOf(needle);
  if (at < 0) return { before: clip(text, 0, EXCERPT_LENGTH), match: '', after: '' };

  const matchStart = starts[at];
  const lastChar = starts[at + needle.length - 1];
  const matchEnd = lastChar + 1;

  let from = Math.max(0, matchStart - CONTEXT_BEFORE);
  if (from > 0) {
    const space = text.indexOf(' ', from);
    if (space >= 0 && space < matchStart) from = space + 1;
  }
  const to = Math.min(text.length, Math.max(matchEnd, from + EXCERPT_LENGTH));

  return {
    before: (from > 0 ? '…' : '') + text.slice(from, matchStart),
    match: text.slice(matchStart, matchEnd),
    after: text.slice(matchEnd, to) + (to < text.length ? '…' : ''),
  };
}

function clip(text: string, from: number, length: number): string {
  return text.length > from + length ? text.slice(from, from + length) + '…' : text.slice(from);
}
