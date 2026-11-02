// Seeds Firestore `verses/{lang}` — the 100 daily-reminder verses per
// language that api/send-daily-reminder.ts pushes to Web Push subscribers.
//
// Only this script writes the collection, with the Admin SDK;
// firestore.rules denies all client access to `verses`, so nobody can
// change the text that is pushed to every subscriber.
//
// The source is public/assets/verses/<lang>.json — hand-checked files with
// the same references as en.json (English is bundled in the cron itself, so
// it isn't seeded). They are static because the CDN Bible JSONs have no
// reliable verse boundaries: poetry is split per line, headings are mixed
// in, and paraphrases merge verses, so "the Nth line of the chapter" is
// often the wrong verse. To fix or add a translation, edit those files and
// re-run this script.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" npx tsx scripts/seed-verses.ts           # dry run: shows what would change
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" npx tsx scripts/seed-verses.ts --write   # writes to Firestore
//
// GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json also works
// instead of FIREBASE_SERVICE_ACCOUNT.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Must match VERSE_LANGUAGES in src/app/services/verse.service.ts (minus
// 'en'). The doc id is what the app stores as a push subscription's
// `language` (selectedBible.split('-')[0]).
const SEED_LANGUAGES = ['pt', 'es', 'ja', 'zh'];

interface VerseEntry {
  book: number;
  abbrev: string;
  chapter: number;
  verse: number;
  ref: string;
  theme: 'scripture' | 'connection' | 'love';
  text: string;
}

const versesDir = join(__dirname, '..', 'public', 'assets', 'verses');
const load = (lang: string) => JSON.parse(readFileSync(join(versesDir, `${lang}.json`), 'utf8')) as VerseEntry[];

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

// Every file must be a translation of en.json: same references, same order,
// non-empty text.
function validate(lang: string, verses: VerseEntry[], english: VerseEntry[]): void {
  if (verses.length !== english.length) throw new Error(`${lang}: ${verses.length} verses, expected ${english.length}`);
  verses.forEach((v, i) => {
    const e = english[i];
    if (v.ref !== e.ref || v.book !== e.book || v.chapter !== e.chapter || v.verse !== e.verse) {
      throw new Error(`${lang}[${i}]: ${v.ref} doesn't match en ${e.ref}`);
    }
    if (!v.text?.trim()) throw new Error(`${lang}[${i}] ${v.ref}: empty text`);
  });
}

async function main() {
  const write = process.argv.includes('--write');
  const english = load('en');
  const db = getFirestore(initializeApp({ credential: credential() }));

  for (const lang of SEED_LANGUAGES) {
    const verses = load(lang);
    validate(lang, verses, english);

    const ref = db.collection('verses').doc(lang);
    const snap = await ref.get();
    const current = snap.exists ? (snap.data()?.['verses'] as VerseEntry[] | undefined) : undefined;

    const changed = verses.filter((v, i) => current?.[i]?.text !== v.text || current?.[i]?.ref !== v.ref);
    const status = !current ? 'new' : changed.length ? `${changed.length} changed` : 'unchanged';
    console.log(`${lang}: ${status}`);
    if (current) {
      for (const v of changed) {
        const old = current.find(c => c.book === v.book && c.chapter === v.chapter);
        console.log(`  ${v.ref}\n    stored: ${old ? `${old.ref} ${old.text}` : '(missing)'}\n    new:    ${v.text}`);
      }
    }

    if (write && (!current || changed.length)) {
      await ref.set({ verses });
      console.log('  written');
    }
  }

  if (!write) console.log('\nDry run — re-run with --write to save.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
