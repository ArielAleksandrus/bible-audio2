import type { VercelRequest, VercelResponse } from '@vercel/node';
import webpush from 'web-push';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import enVerses from '../public/assets/verses/en.json';

interface VerseEntry {
  ref: string;
  text: string;
}

interface SubscriptionDoc {
  subscription: webpush.PushSubscription;
  language?: string;
}

// Vercel Cron trigger (see vercel.json) — runs once a day, picks a random
// verse per subscriber (in their selected Bible language, falling back to
// English), and sends it as a Web Push notification.
//
// Required env vars (set in Vercel project settings, never committed):
//   CRON_SECRET               — Vercel auto-attaches this as the Authorization
//                                 header on Cron-triggered requests once set.
//   VAPID_PRIVATE_KEY         — pairs with environment.vapidPublicKey in the app.
//   FIREBASE_SERVICE_ACCOUNT  — the Firebase service account JSON, as a string.
//   ENABLE_DAILY_REMINDER_CRON — must be exactly "true" for this to actually
//                                 send. bible-audio2 and biblia-narrada are
//                                 two separate Vercel projects built from the
//                                 same repo (and the same Firestore data), so
//                                 both register this same cron independently
//                                 — without this flag they'd double-send every
//                                 subscriber's daily notification. Set it to
//                                 "true" on exactly one of the two projects.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env['CRON_SECRET']}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (process.env['ENABLE_DAILY_REMINDER_CRON'] !== 'true') {
    res.status(200).json({ skipped: true, reason: 'ENABLE_DAILY_REMINDER_CRON not set on this deployment' });
    return;
  }

  const vapidPublicKey = process.env['VAPID_PUBLIC_KEY'];
  const vapidPrivateKey = process.env['VAPID_PRIVATE_KEY'];
  const serviceAccountJson = process.env['FIREBASE_SERVICE_ACCOUNT'];
  if (!vapidPublicKey || !vapidPrivateKey || !serviceAccountJson) {
    res.status(500).json({ error: 'Missing required environment variables' });
    return;
  }

  webpush.setVapidDetails('mailto:support@bibleaudio.app', vapidPublicKey, vapidPrivateKey);

  // Dashboard env var inputs sometimes mangle the private_key field's escaped
  // newlines in transit — normalize regardless of how it actually arrived
  // (a no-op if it was already fine).
  const serviceAccount = JSON.parse(serviceAccountJson);
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(app);

  const verseCache = new Map<string, VerseEntry[]>();
  verseCache.set('en', enVerses as VerseEntry[]);

  async function versesFor(lang: string): Promise<VerseEntry[]> {
    const cached = verseCache.get(lang);
    if (cached) return cached;
    const snap = await db.collection('verses').doc(lang).get();
    const verses = (snap.exists ? (snap.data()?.['verses'] as VerseEntry[]) : undefined) ?? (enVerses as VerseEntry[]);
    verseCache.set(lang, verses);
    return verses;
  }

  const subscriptions = await db.collection('push_subscriptions').get();

  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(subscriptions.docs.map(async doc => {
    const data = doc.data() as SubscriptionDoc;
    try {
      const verses = await versesFor(data.language || 'en');
      const verse = verses[Math.floor(Math.random() * verses.length)];

      const payload = JSON.stringify({
        notification: {
          title: 'BibleAudio',
          body: `"${verse.text}" — ${verse.ref}`,
          icon: '/icons/android/android-launchericon-192-192.png',
          data: { url: '/home' }
        }
      });

      await webpush.sendNotification(data.subscription, payload);
      sent++;
    } catch (err) {
      failed++;
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription is gone (browser data cleared, uninstalled, etc.) — stop retrying it.
        await doc.ref.delete();
        removed++;
      } else {
        console.warn('send-daily-reminder: failed to send to', doc.id, err);
      }
    }
  }));

  res.status(200).json({ total: subscriptions.size, sent, failed, removed });
}
