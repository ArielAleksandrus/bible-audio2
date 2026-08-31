import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { BibleBook } from 'bible-picker';

interface ChapterEntry {
  heading: boolean;
  text: string;
  verseNumber?: number;
}
interface RenderedChapter {
  number: number;
  entries: ChapterEntry[];
}

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
const HEADING_MAX_LENGTH = 80;
const TRAILING_PUNCTUATION = /[.!?;:,'"’”)]\s*$/;
const LATIN_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/g;
const LATIN_UPPERCASE = /[A-ZÀ-ÖØ-Þ]/;

@Component({
  selector: 'app-bible-text-viewer',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './bible-text-viewer.html',
  styleUrl: './bible-text-viewer.scss'
})
export class BibleTextViewer {
  @Input() book!: BibleBook;
  @Input() chapters: number[] = [];
  @Output() close = new EventEmitter<void>();

  // Bible JSONs aren't consistent on which field carries the display name
  // (e.g. "zh-cnvs" has no "name" at all, just "english"/"chinese"/"abbrev")
  // — fall back through the known variants rather than showing "undefined".
  get bookDisplayName(): string {
    const b = this.book as unknown as Record<string, string>;
    return b?.['name'] || b?.['chinese'] || b?.['japanese'] || b?.['english'] || b?.['abbrev'] || '';
  }

  get renderedChapters(): RenderedChapter[] {
    if (!this.book) return [];
    return this.chapters.map(number => ({
      number,
      entries: this.parseChapter(this.book.chapters[number - 1] || [])
    }));
  }

  private parseChapter(raw: string[]): ChapterEntry[] {
    let verseNumber = 0;
    return raw.map(text => {
      if (this.isHeading(text)) return { heading: true, text };
      verseNumber++;
      return { heading: false, text, verseNumber };
    });
  }

  private isHeading(text: string): boolean {
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
}
