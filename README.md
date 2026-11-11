# Bíblia Narrada

An app (PWA + native Android/iOS via Ionic & Capacitor) for listening to the Bible offline, including with the screen locked and from car Bluetooth controls.

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

The Bibles on offer are listed in one place, `src/app/data/bible-catalog.ts` — the CDN can't list its own files, so a version exists for the app only once it is written there. The first entry of a language is its default. A language with two or more entries gets a version switch (Home and Settings); a version with two or more `narrators` gets a narrator switch (Settings and the player) and keeps each narrator's audio in its own CDN folder and under its own download key. The comment in that file shows how to add one.

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

## Native apps (Android / iOS)

The same Angular code base ships as the PWA **and** as native apps built with
[Capacitor](https://capacitorjs.com/) (`android/`, `ios/`). The UI uses
[Ionic](https://ionicframework.com/) components, so it gets iOS styling on
iPhone and Material styling on Android automatically.

What changes on native (`isNativeApp()` in `src/app/utils/platform.util.ts`):

| | Web / PWA | Native app |
|---|---|---|
| Playback | `WebAudioEngine` — two `<audio>` elements + all the locked-screen workarounds (see `.claude/skills/gapless-audio-lockscreen`) | `NativeAudioEngine` — the whole playlist goes to the OS player via [`@dwbn/capacitor-plugin-playlist`](https://www.npmjs.com/package/@dwbn/capacitor-plugin-playlist): Media3/ExoPlayer foreground service on Android, AVQueuePlayer on iOS. Lock screen, notification, headset and car Bluetooth controls are native. |
| Downloaded chapters | IndexedDB blobs | Files in the app's data dir (`audios/*.mp3`), downloaded with the native HTTP stack (`@capacitor/file-transfer`), so the OS player can open them and downloads continue in the background |
| Bible JSON | `fetch` with progress | native HTTP (no CORS) |
| Google sign-in | Firebase popup | native account picker (`@capacitor-firebase/authentication`), then the same Firebase JS SDK/Firestore sync |
| Daily verse | Web Push from the Vercel cron | 30 days of local notifications scheduled on the device, with verses from the downloaded Bible (works offline, no FCM/APNs needed) |
| Service worker, install banner, Safari/Instagram warnings | yes | off |

A chapter queued while still streaming is swapped for its local file as soon
as it finishes downloading, so a playlist started online keeps playing after
the connection drops.

### Build & run

```bash
npm run build        # web build → dist/bible-audio2/browser
npx cap sync         # copy it into android/ and ios/ + update native plugins
npx cap open android # Android Studio
npx cap open ios     # Xcode (macOS only)
```

Run `npm run build && npx cap sync` again after every web change. Icons and
splash screens are generated from `assets/` with
`npx capacitor-assets generate --iconBackgroundColor '#eaded0' --splashBackgroundColor '#0f3d3e'`.

### Versions and updates

The version in `package.json` is the app's version everywhere (web, Android `versionName`, iOS `MARKETING_VERSION`).

- **Major** (`X.0.0`) — only when the apps need a new native build for the stores: a new or upgraded Capacitor plugin, a new permission, a change in `android/` or `ios/` that the web code relies on. Raise `NATIVE_LEVEL` in `src/app/services/ota.service.ts` together with it when the web code now depends on that native change. Pushing the tag `vX.0.0` starts the Android build in Codemagic; the iOS build (`ios-loja`) is started from the button.
- **Minor** (new feature) and **patch** (fix) — reach the installed apps **over the air**, with no store build.

How over the air works (`@capgo/capacitor-updater` in manual mode, nothing goes through Capgo's cloud):

1. Vercel runs `npm run build:web` (`vercel.json`): `ng build`, then `scripts/ota-bundle.mjs` zips the build into `ota/<version>.zip` and writes `ota/manifest.json` (version, native level, sha256), both deployed with the site.
2. On launch and on every return to the foreground, the store app reads `environment.otaUrl`. A newer version of the **same native level** is downloaded in the background and takes effect the next time the app leaves the screen — never in the middle of a chapter.
3. A bundle that fails to open is rolled back by the plugin and not downloaded again; the fix goes out as the next version.

So a web-only release is: bump the version in `package.json`, merge to `master`. Without the bump the apps keep what they have.

After a new **major** is live in a store, write its version in `ota-store.json` (`{ "android": "3.0.0", "ios": null }`) and deploy: apps still on the older shell then get a dismissible notice that leads to the store, since they no longer receive anything over the air.

### Before the first store upload

- [x] **App id** — Android uses `live.nlabs.biblia` (`capacitor.config.ts`,
      `applicationId`); `live.nlabs.bible` is permanently taken on Google Play
      by an old app. The Java namespace and the iOS bundle id are still
      `live.nlabs.bible`. Both packages are registered in Firebase. The Play
      package cannot change after publishing.
- [ ] **Privacy policy URL** — both stores require one; any public page works
      (e.g. a `/privacy` page on the Vercel deploy or on `biblia.nlabs.live`).
- [ ] **Firebase native apps** — add an Android app and an iOS app with that id
      in the Firebase console, then put `google-services.json` in
      `android/app/` and `GoogleService-Info.plist` in `ios/App/App/` (add it to
      the Xcode target). Without them native Google sign-in fails; everything
      else works.
- [ ] **Android Google sign-in** — register the SHA-1 of the debug and
      release/Play signing keys in the Firebase Android app.
- [ ] **iOS Google sign-in** — replace `REPLACE_WITH_REVERSED_CLIENT_ID` in
      `ios/App/App/Info.plist` with `REVERSED_CLIENT_ID` from
      `GoogleService-Info.plist`.
- [x] **Sign in with Apple** — App Store guideline 4.8 requires it when Google
      sign-in is offered. iOS only: `App/App.entitlements`, `'apple.com'` in
      `FirebaseAuthentication.providers`, a button in Settings. Still needs the
      Apple provider enabled in Firebase Auth and the capability on the App ID.
- [ ] **iOS release (Codemagic `ios-loja`)** — register the bundle id
      `live.nlabs.bible` (with Sign in with Apple), create the app in App Store
      Connect, reuse the `carteira_pro_asc` App Store Connect integration in Codemagic,
      then start the workflow from the button; every build goes to TestFlight.
- [ ] **Store icon** — `assets/icon-only.png` is cropped from the PWA icon
      (which has a black border and a generator watermark); replace it with a
      clean 1024×1024 master and regenerate.
- [ ] Test on real devices: locked-screen playback across chapters, car
      Bluetooth next/previous, offline playback after a full download.

## Tech stack

- Angular 21 (standalone components) + Ionic 9
- Capacitor 8 (Android/iOS shells) + native playlist player
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

The same repo is deployed as **two separate Vercel projects** — `bible-audio2` (original URL, already had users before the rename) and `biblia-narrada` (new branded domain) — rather than two domains on one project, since a second `.vercel.app` alias on a single project requires a paid plan. Both build independently on every push to `master`. The production build registers `ngsw-worker.js`. The store apps read their over-the-air updates from `bible-audio2.vercel.app/ota/` (see [Versions and updates](#versions-and-updates)).

The daily-reminder function (`api/send-daily-reminder.ts`) needs these Vercel environment variables (not committed), set separately on **each** project:

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Vercel Cron `Authorization` bearer token |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push VAPID pair (public key also in `environment.ts`) |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin JSON, as a string |
| `ENABLE_DAILY_REMINDER_CRON` | Must be `true` on **exactly one** of the two projects — both register the same cron against the same Firestore data, so leaving it unset on the other prevents every subscriber getting the daily push twice |

`api/plan-stats.ts` keeps the global per-plan counters (`planStats/{planId}`: `starts`, `completions`, `listens`) behind the "most listened" sort. It only needs `FIREBASE_SERVICE_ACCOUNT`, on **both** projects. It is public by design and accepts nothing but `{ planId, event }` for a known plan. The native apps call it at `environment.apiOrigin`.

Sign in with Apple on the web needs the Apple provider configured in Firebase first: see [docs/apple-sign-in-web.md](docs/apple-sign-in-web.md).

Both projects point at the same Firebase project, so `biblia-narrada.vercel.app` also needs to be added under Firebase Console → Authentication → Settings → Authorized domains for Google sign-in to work there.

Firestore rules live in `firestore.rules` (paste them into Firebase Console → Firestore → Rules to deploy): each signed-in user can only read/write `users/{uid}/**`; devices can create/overwrite/delete their own `push_subscriptions/{deviceId}` but not read any; `verses/{lang}` and `planStats/{planId}` are closed to clients.

`verses/{lang}` holds the daily-reminder verses the Web Push cron sends for each non-English language. Seed or refresh it with the service account (dry run first, then `--write`):

```
FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" npx tsx scripts/seed-verses.ts
FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" npx tsx scripts/seed-verses.ts --write
```

The verses come from `public/assets/verses/<lang>.json`, hand-checked translations of `en.json` (same references and order) that the native app also uses for its local reminders. Edit those files to fix a verse or add a language (also add it to `VERSE_LANGUAGES` in `verse.service.ts` and `SEED_LANGUAGES` in the script), then run the script again.

## Project layout

```
src/app/
  pages/          Tabs shell, Home, Plans, Settings
  components/     audio player, Bible text viewer, install & notification prompts
  services/       audio (web + native engines), downloader, bible, plans, auth, sync, notifications, analytics
  storage/        IndexedDB schema (`audio-db`), audio file storage (IndexedDB/Filesystem), Firebase helpers
android/, ios/    Capacitor native projects
assets/           source images for native icons/splash
public/assets/
  i18n/           UI translations
  plans/          plan JSON
  verses/         fallback daily-reminder verses
api/              Vercel Cron handler
```
