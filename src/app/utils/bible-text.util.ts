// Shared heading-detection + verse extraction for raw Bible chapter arrays
// (plain string[] per chapter, no explicit verse-boundary metadata). Used by
// BibleTextViewer (continuous reading) and VerseService (pinpointing a
// single reference for notifications).
//
// A heading has no explicit flag in the data — it's inferred: short, no
// trailing sentence punctuation, and every significant (4+ letter) word
// capitalized, i.e. actual Title Case ("The Word Became Flesh"). Just
// "short + no trailing punctuation" isn't enough — poetic books like Psalms
// split single verses into several short punctuation-free lines
// ("He guides me along the right paths") that would otherwise be
// misclassified as headings. This only recognizes headings written with
// Latin letters (versions vary on whether they include headings at all,
// e.g. "en-niv"/"es-nvi" do, "pt-ara" doesn't); CJK versions have no case
// distinction to detect against, so their headings just render as regular
// (numbered) lines instead of being missed by a false-positive match.
//
// Known limitation: some verses are split across multiple array entries for
// poetic formatting, which can shift the sequential count for verses later
// in the same chapter. Reliable for continuous reading; pinpointing one
// specific verse by number can occasionally land 1-2 verses off, especially
// in heavily poetic books (Psalms).
const HEADING_MAX_LENGTH = 80;
const TRAILING_PUNCTUATION = /[.!?;:,'"’”)]\s*$/;
const LATIN_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/g;
const LATIN_UPPERCASE = /[A-ZÀ-ÖØ-Þ]/;

export function isHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > HEADING_MAX_LENGTH) return false;
  if (TRAILING_PUNCTUATION.test(trimmed)) return false;

  // "Significant" words (4+ letters) must ALL start with a capital —
  // true Title Case, not just a capitalized first word of a sentence.
  const significantWords = trimmed.split(/\s+/).filter(w => (w.match(LATIN_LETTER) || []).length >= 4);
  if (significantWords.length === 0) return false;

  return significantWords.every(w => {
    const firstLetter = w.match(LATIN_LETTER);
    return !!firstLetter && LATIN_UPPERCASE.test(firstLetter[0]);
  });
}

export interface ChapterEntry {
  heading: boolean;
  text: string;
  verseNumber?: number;
}

// Numbers a raw chapter's entries sequentially, skipping detected headings.
export function parseChapter(raw: string[]): ChapterEntry[] {
  let verseNumber = 0;
  return raw.map(text => {
    if (isHeading(text)) return { heading: true, text };
    verseNumber++;
    return { heading: false, text, verseNumber };
  });
}

// Pulls a single verse's text by (chapter, verseNumber) out of a raw chapter
// array, skipping headings the same way parseChapter does. Returns undefined
// if the chapter/verse is out of range.
export function getVerseText(chapters: string[][], chapter: number, verseNumber: number): string | undefined {
  const raw = chapters[chapter - 1];
  if (!raw) return undefined;
  let n = 0;
  for (const text of raw) {
    if (isHeading(text)) continue;
    n++;
    if (n === verseNumber) return text;
  }
  return undefined;
}

// Bible JSONs aren't consistent on which field carries a book's display name
// (e.g. "zh-cnvs" has no "name" at all, just "english"/"chinese"/"abbrev").
export function bookDisplayName(book: unknown): string {
  const b = book as Record<string, string> | undefined;
  return b?.['name'] || b?.['chinese'] || b?.['japanese'] || b?.['english'] || b?.['abbrev'] || '';
}
