// Seeds Firestore `verses/{lang}` — the 50 daily-reminder verses per
// language that api/send-daily-reminder.ts pushes to Web Push subscribers.
//
// The app used to derive and write these itself the first time someone
// downloaded a Bible in that language, which meant the collection had to be
// world-writable (anyone could replace the text pushed to every
// subscriber). Now only this script writes it, with the Admin SDK, and
// firestore.rules denies all client access to `verses`.
//
// Each language takes the same (book, chapter, verse) references as the
// bundled English set (public/assets/verses/en.json), with the text pulled
// from that language's Bible JSON on the CDN using the same extraction the
// app uses (getVerseText). A reference not found falls back to English.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" npx tsx scripts/seed-verses.ts           # dry run: shows what would change
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" npx tsx scripts/seed-verses.ts --write   # writes to Firestore
//
// GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json also works
// instead of FIREBASE_SERVICE_ACCOUNT. Re-run when a Bible version is added
// to SEED_VERSIONS or a CDN JSON is corrected.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { getVerseText } from '../src/app/utils/bible-text.util';

const BIBLE_CDN_URL = 'https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev';

// One Bible version per non-English language, matching the versions offered
// by bible-picker. The doc id is the language part, which is what the app
// stores as a push subscription's `language` (selectedBible.split('-')[0]).
const SEED_VERSIONS = ['pt-ara', 'es-nvi', 'ja-jcb', 'zh-cnvs'];

interface VerseEntry {
  book: number;
  abbrev: string;
  chapter: number;
  verse: number;
  ref: string;
  theme: 'scripture' | 'connection' | 'love';
  text: string;
}

interface BibleJson {
  books: { chapters: string[][] }[];
}

function credential() {
  const json = process.env['FIREBASE_SERVICE_ACCOUNT'];
  if (!json) return applicationDefault();
  const account = JSON.parse(json);
  // Same normalization as api/send-daily-reminder.ts.
  if (typeof account.private_key === 'string') {
    account.private_key = account.private_key.replace(/\\n/g, '\n');
  }
  return cert(account);
}

async function fetchBible(version: string): Promise<BibleJson> {
  const url = `${BIBLE_CDN_URL}/jsons/${version}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return (await res.json()) as BibleJson;
}

function deriveVerses(english: VerseEntry[], bible: BibleJson): { verses: VerseEntry[]; missing: string[] } {
  const missing: string[] = [];
  const verses = english.map(ref => {
    const book = bible.books[ref.book];
    const text = book ? getVerseText(book.chapters, ref.chapter, ref.verse) : undefined;
    if (!text) missing.push(ref.ref);
    return text ? { ...ref, text } : ref;
  });
  return { verses, missing };
}

async function main() {
  const write = process.argv.includes('--write');
  const english = JSON.parse(
    readFileSync(join(__dirname, '..', 'public', 'assets', 'verses', 'en.json'), 'utf8'),
  ) as VerseEntry[];

  const db = getFirestore(initializeApp({ credential: credential() }));

  for (const version of SEED_VERSIONS) {
    const lang = version.split('-')[0];
    const { verses, missing } = deriveVerses(english, await fetchBible(version));

    const ref = db.collection('verses').doc(lang);
    const snap = await ref.get();
    const current = snap.exists ? (snap.data()?.['verses'] as VerseEntry[] | undefined) : undefined;

    // Report every entry whose text differs from what's stored — after the
    // collection having been world-writable, this is also how to spot
    // anything that was tampered with.
    const changed = verses.filter((v, i) => current?.[i]?.text !== v.text);
    const status = !current ? 'new' : changed.length ? `${changed.length} changed` : 'unchanged';
    console.log(`${lang} (${version}): ${status}${missing.length ? `, ${missing.length} fell back to English: ${missing.join(', ')}` : ''}`);
    if (current) {
      for (const v of changed) {
        const old = current.find(c => c.ref === v.ref)?.text ?? '(missing)';
        console.log(`  ${v.ref}\n    stored: ${old}\n    new:    ${v.text}`);
      }
    }

    if (write && (!current || changed.length)) {
      await ref.set({ verses });
      console.log(`  written`);
    }
  }

  if (!write) console.log('\nDry run — re-run with --write to save.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
