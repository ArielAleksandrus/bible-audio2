import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Firestore } from 'firebase/firestore';
import type { Bible } from 'bible-picker';
import { firstValueFrom } from 'rxjs';

import { firebaseEnabled, getFirestoreDb } from '../storage/firebase';
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
// static asset; other languages are derived client-side, the moment a user
// downloads a Bible in that language, from the exact same (book, chapter,
// verse) references, then saved to Firestore so the Cron job that actually
// sends notifications (which has no access to a client's IndexedDB) can
// read them back at send time.
@Injectable({ providedIn: 'root' })
export class VerseService {
  private englishVerses: Promise<VerseEntry[]> | null = null;
  private fsModule: Promise<typeof import('firebase/firestore')> | null = null;

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

  // Saves this language's verse set to Firestore, but only the first time —
  // cheap idempotency check so re-downloading the same language repeatedly
  // doesn't keep re-writing it.
  async saveVersesForLanguage(lang: string, verses: VerseEntry[]): Promise<void> {
    if (!firebaseEnabled || lang === 'en') return;
    try {
      const [db, { doc, getDoc, setDoc }] = await Promise.all([this.getDb(), this.getFsModule()]);
      const ref = doc(db, 'verses', lang);
      const existing = await getDoc(ref);
      if (existing.exists()) return;
      await setDoc(ref, { verses: JSON.parse(JSON.stringify(verses)) });
    } catch (err) {
      console.warn('VerseService: failed to save verses for', lang, err);
    }
  }

  private getFsModule() {
    if (!this.fsModule) this.fsModule = import('firebase/firestore');
    return this.fsModule;
  }

  private getDb(): Promise<Firestore> {
    return getFirestoreDb();
  }
}
