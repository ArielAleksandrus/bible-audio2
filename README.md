# Bíblia Narrada

A Progressive Web App for listening to the Bible offline, including with the screen locked and from car Bluetooth controls.

Live app: [https://bible-audio2.vercel.app/](https://bible-audio2.vercel.app/) or [https://biblia-narrada.vercel.app/](https://biblia-narrada.vercel.app/) — same build, deployed twice (see [Deploy](#deploy)).

The goal is simple: pick chapters or a reading plan, download the audio to the device, and keep listening for over an hour without the phone having to stay awake or online.

## What it does

- **Listen by book and chapter** — choose a translation, then any range of chapters. The first chapter starts as soon as it is cached; the rest of the selection downloads in the background.
- **Offline playback** — chapter MP3s and Bible text live in IndexedDB on the device. After a download, Wi‑Fi is not required.
- **Download the whole Bible** — about 1.3 GB. The button is shown only when the device has enough free space; a warning is shown on cellular data.
- **Reading plans** — start, resume, mark days complete, and play a day’s portions as a playlist. Progress is stored locally and can sync across devices.
- **Lock screen and car controls** — play, pause, next, previous, and seek go through the Media Session API (notification shade, headset, Bluetooth head unit).
- **Continuous chapters** — the next chapter is pre-downloaded into a blob and started on a second `<audio>` element *before* the current one finishes, so mobile browsers do not treat the handoff as a new autoplay (which they would block).
- **Bible text beside the audio** — when you pick chapters on Home, the matching text is shown while it plays.
- **Daily verse reminder** — optional Web Push, once a day, in the language of the selected Bible.
- **Optional Google sign-in** — plan progress and completion counts sync through Firestore. The app works fully without an account.

## Languages and translations

| Language | Bible version |
|---|---|
| Português | ARA |
| English | NIV |
| Español | NVI |
| 中文 (Simplified) | CNVS |
| 日本語 | JCB |

UI strings follow the selected Bible language (`public/assets/i18n/`).

## Reading plans

| Plan | Length |
|---|---|
| First Steps in the Bible | 7 days |
| New Testament in 90 Days | 90 days |
| Christmas in 7 Days | 7 days |
| Easter in 7 Days | 7 days |
| Walking Through the Valley of the Shadow of Death | 7 days |
| Let’s read the Bible together (YouVersion) | 365 days |

Starting a plan builds a playlist from the current day plus the next 7 days of audio, so you can listen ahead offline.

## Screens

- **Home** — language/version picker, book/chapter selection, full-Bible download, text viewer.
- **Plans** — available / started / completed plans, day table, play a day, resume where you stopped.
- **Settings** — storage usage, clear downloaded audio, reset language, Google sign-in, daily reminders, app version.

A global mini-player (skip ±10s, previous/next, seek) stays on screen while something is playing.

## How playback works

Audio files are fetched from a Cloudflare R2 CDN (`…/audios/{lang}/{VERSION}/{BOOK}/{BOOK} {chapter}.mp3`) and stored as blobs in IndexedDB (`audio-db` → `files`). Bible JSON, plan state, an analytics queue, and plan completion counts use the same database.

Two `HTMLAudioElement`s are used:

1. The active element plays the current chapter (blob URL if cached, otherwise the CDN URL so playback is not blocked on a full download).
2. The inactive element is loaded with the *next* chapter’s blob. Near the end of the current chapter it is started muted so the audio session never goes idle; on `ended` it is unmuted and swapped in.

If the next chapter is not buffered in time, the player falls back to setting the next URL on the same element and calling `play()` synchronously from `ended`.

## Browser notes

Background audio, Media Session, and Web Push work best in **Chrome / Chromium** (including an installed PWA on Android).

On **iPhone / iPad**, add the app to the Home Screen (Share → Add to Home Screen). Safari — and Chrome on iOS, which is still WebKit — will not keep background audio or push notifications working the same way unless the app is installed.

When a new version is deployed, the service worker downloads it and the app offers a **Reload** snackbar.

## Tech stack

- Angular 21 (standalone components, Material)
- Angular service worker (PWA)
- IndexedDB via `idb`
- `bible-picker` for book/chapter UI
- ngx-translate
- Firebase Auth + Firestore (optional sync and push subscriptions)
- Vercel (static app + `/api/send-daily-reminder` cron at 13:00 UTC)
- GA4 (events queued in IndexedDB while offline, flushed when online)

## Development

Requires Node and npm 11 (see `packageManager` in `package.json`).

```bash
npm install
npm start
```

Then open `http://localhost:4200/`. The service worker is disabled in the development configuration.

```bash
npm test          # Vitest via Angular’s unit-test builder
npm run build     # production build → dist/bible-audio2
```

App version is read from `package.json` (`environment.appVersion`) and shown on Settings.

## Deploy

The same repo is deployed as **two separate Vercel projects** — `bible-audio2` (original URL, already had users before the rename) and `biblia-narrada` (new branded domain) — rather than two domains on one project, since a second `.vercel.app` alias on a single project requires a paid plan. Both build independently on every push to `master`. The production build registers `ngsw-worker.js`.

The daily-reminder function (`api/send-daily-reminder.ts`) needs these Vercel environment variables (not committed), set separately on **each** project:

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Vercel Cron `Authorization` bearer token |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push VAPID pair (public key also in `environment.ts`) |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin JSON, as a string |
| `ENABLE_DAILY_REMINDER_CRON` | Must be `true` on **exactly one** of the two projects — both register the same cron against the same Firestore data, so leaving it unset on the other prevents every subscriber getting the daily push twice |

Both projects point at the same Firebase project, so `biblia-narrada.vercel.app` also needs to be added under Firebase Console → Authentication → Settings → Authorized domains for Google sign-in to work there.

Firestore rules live in `firestore.rules`: each signed-in user can only read/write `users/{uid}/**`; `verses/{lang}` and `push_subscriptions/{deviceId}` are used for reminders.

## Project layout

```
src/app/
  pages/          Home, Plans, Settings
  components/     audio player, Bible text viewer, install & notification prompts
  services/       audio, downloader, playlist, bible, plans, auth, sync, push, analytics
  storage/        IndexedDB schema (`audio-db`) and Firebase helpers
public/assets/
  i18n/           UI translations
  plans/          plan JSON
  verses/         fallback daily-reminder verses
api/              Vercel Cron handler
```
