import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface VerseEntry {
  book: number;
  abbrev: string;
  chapter: number;
  verse: number;
  ref: string;
  theme: 'scripture' | 'connection' | 'love';
  text: string;
}

// Languages with a translated copy of the reminder verses in
// public/assets/verses/<lang>.json (see scripts/seed-verses.ts).
export const VERSE_LANGUAGES = ['en', 'pt', 'es', 'ja', 'zh'];

// 100 curated verses, each one that reads on its own (importance of
// Scripture, connecting to God, God's love for us), used for daily reminder
// notifications. Each language is a static,
// hand-checked file with the same references as the English one — the
// Bible JSONs have no reliable verse boundaries (poetry split per line,
// headings, paraphrases that merge verses), so picking "the Nth line" lands
// on the wrong verse. Native local notifications read these directly; the
// Web Push cron reads the copies scripts/seed-verses.ts puts in Firestore.
@Injectable({ providedIn: 'root' })
export class VerseService {
  private cache = new Map<string, Promise<VerseEntry[]>>();

  constructor(private http: HttpClient) {}

  /** Verses in `lang` (e.g. 'pt'), falling back to English. */
  getVerses(lang: string): Promise<VerseEntry[]> {
    const key = VERSE_LANGUAGES.includes(lang) ? lang : 'en';
    let pending = this.cache.get(key);
    if (!pending) {
      pending = firstValueFrom(this.http.get<VerseEntry[]>(`/assets/verses/${key}.json`)).catch(err => {
        this.cache.delete(key);
        if (key === 'en') throw err;
        console.warn('VerseService: falling back to English for', key, err);
        return this.getVerses('en');
      });
      this.cache.set(key, pending);
    }
    return pending;
  }
}
