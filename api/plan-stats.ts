import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import firstSteps from '../public/assets/plans/first-steps.json';
import newTestament from '../public/assets/plans/new-testament.json';
import christmas from '../public/assets/plans/christmas.json';
import easter from '../public/assets/plans/easter.json';
import valleyOfShadow from '../public/assets/plans/valley-of-shadow.json';

// Global, anonymous usage counters per reading plan — how often each one was
// started, completed and listened to, across every user (the app works
// signed out, so this can't hang off a user document). Used to sort the plan
// list by "most listened".
//
//   GET  /api/plan-stats  → { stats: { [planId]: { starts, completions, listens } } }
//   POST /api/plan-stats  ← { planId, event: "start" | "complete" | "listen" }
//
// Firestore: planStats/{planId} = { starts, completions, listens } — numbers
// only. firestore.rules denies clients all access to that collection; only
// this function (Admin SDK, which bypasses the rules) reads or writes it.
//
// Required env var (Vercel project settings, never committed):
//   FIREBASE_SERVICE_ACCOUNT — the Firebase service account JSON, as a string
//                              (the same one send-daily-reminder uses).
//
// This endpoint is public and unauthenticated by design. What a caller can
// do is limited to adding 1 to one of three counters of a known plan —
// nothing is read from the body except the two validated fields, so no
// free-form data can be stored. The counters are therefore only as
// trustworthy as a public "like" count: fine for ordering a list, not for
// anything that matters.

// The only ids that can be counted: the plans shipped in public/assets/plans,
// plus the one-year plan that lives in the app bundle (src/app/data/my-plans.ts).
const PLAN_IDS: ReadonlySet<string> = new Set<string>([
  firstSteps.id,
  newTestament.id,
  christmas.id,
  easter.id,
  valleyOfShadow.id,
  'youversion-365',
]);

const FIELD_BY_EVENT = {
  start: 'starts',
  complete: 'completions',
  listen: 'listens',
} as const;
type StatEvent = keyof typeof FIELD_BY_EVENT;

function db() {
  const serviceAccountJson = process.env['FIREBASE_SERVICE_ACCOUNT'];
  if (!serviceAccountJson) return null;
  // Dashboard env var inputs sometimes mangle the private_key field's escaped
  // newlines in transit — normalize regardless of how it actually arrived.
  const serviceAccount = JSON.parse(serviceAccountJson);
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  return getFirestore(app);
}

const count = (value: unknown): number => (typeof value === 'number' && isFinite(value) ? value : 0);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // The Android/iOS apps call this from their WebView origin
  // (https://localhost, capacitor://localhost). No cookies or credentials
  // are involved, so any origin may call it.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Validate before touching Firestore, so a bad request costs nothing.
  let planId = '';
  let event: StatEvent | undefined;
  if (req.method === 'POST') {
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const { planId: id, event: ev, ...rest } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (
      typeof id !== 'string' || !PLAN_IDS.has(id) ||
      typeof ev !== 'string' || !Object.prototype.hasOwnProperty.call(FIELD_BY_EVENT, ev) ||
      Object.keys(rest).length > 0
    ) {
      res.status(400).json({ error: 'Expected exactly { planId, event } with a known plan and event "start" | "complete" | "listen"' });
      return;
    }
    planId = id;
    event = ev as StatEvent;
  }

  const firestore = db();
  if (!firestore) {
    res.status(500).json({ error: 'Missing required environment variables' });
    return;
  }

  try {
    if (event) {
      await firestore.collection('planStats').doc(planId).set(
        { [FIELD_BY_EVENT[event]]: FieldValue.increment(1) },
        { merge: true },
      );
      res.status(200).json({ ok: true });
      return;
    }

    const snap = await firestore.collection('planStats').get();
    const stats: Record<string, { starts: number; completions: number; listens: number }> = {};
    for (const doc of snap.docs) {
      if (!PLAN_IDS.has(doc.id)) continue;
      const data = doc.data();
      stats[doc.id] = {
        starts: count(data['starts']),
        completions: count(data['completions']),
        listens: count(data['listens']),
      };
    }
    // An ordering hint, not live data: let the CDN answer for five minutes.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ stats });
  } catch (err) {
    console.error('plan-stats: Firestore request failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
}
