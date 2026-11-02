import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Bible } from 'bible-picker';
import { firstValueFrom } from 'rxjs';

import { getVerseText } from '../utils/bible-text.util';

export interface VerseEntry {
  book: number;
  abbrev: string;
  chapter: number;
  verse: number;
  ref: string;
  theme: 'scripture' | 'connection' | 'love';
  text: string;
}

// 50 curated verses (importance of Scripture, connecting to God, God's love
// for us) used for daily reminder notifications. English is bundled as a
// static asset; native local notifications derive other languages here from
// the downloaded Bible, using the exact same (book, chapter, verse)
// references. The Web Push cron reads its per-language copies from Firestore
// `verses/{lang}`, which only scripts/seed-verses.ts writes (the same
// derivation, run with the Admin SDK) — clients have no access to it.
@Injectable({ providedIn: 'root' })
export class VerseService {
  private englishVerses: Promise<VerseEntry[]> | null = null;

  constructor(private http: HttpClient) {}

  getEnglishVerses(): Promise<VerseEntry[]> {
    if (!this.englishVerses) {
      this.englishVerses = firstValueFrom(this.http.get<VerseEntry[]>('/assets/verses/en.json'));
    }
    return this.englishVerses;
  }

  // Derives the same 50 references' text from a fully-downloaded Bible in
  // another language. Falls back to the English text for any reference that
  // can't be found in the target language.
  async deriveVerses(bible: Bible): Promise<VerseEntry[]> {
    const refs = await this.getEnglishVerses();
    return refs.map(ref => {
      const book = bible.books[ref.book];
      const text = book ? getVerseText(book.chapters, ref.chapter, ref.verse) : undefined;
      return text ? { ...ref, text } : ref;
    });
  }
}
