# Bíblia Narrada

An app (PWA + native Android/iOS via Ionic & Capacitor) for listening to the Bible offline, including with the screen locked and from car Bluetooth controls.

<p>
  <a href="https://play.google.com/store/apps/details?id=live.nlabs.biblia"><img src="site/img/badges/google-play-en.png" alt="Get it on Google Play" height="48"></a>
  &nbsp;
  <a href="https://apps.apple.com/app/id6832831597"><img src="site/img/badges/app-store-en.svg" alt="Download on the App Store" height="48"></a>
</p>

**Site:** [https://biblia.nlabs.live](https://biblia.nlabs.live) · **Web app:** [bible-audio2.vercel.app](https://bible-audio2.vercel.app/)

**Bible text:** [Open Translation Bible (OTB)](https://openbible.uk) — [site](https://openbible.uk) · [GitHub](https://github.com/OpenTranslationBible/open-bible) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). See [Credits](#credits).

The goal is simple: pick chapters or a reading plan, download the audio to the device, and keep listening for over an hour without the phone having to stay awake or online.

## What it does

- **Listen by book and chapter** — choose a translation, then any range of chapters. The first chapter starts as soon as it is cached; the rest of the selection downloads in the background.
- **Offline playback** — chapter audio and Bible text live in IndexedDB on the device. After a download, Wi‑Fi is not required.
- **Download the whole Bible** — about 1.3 GB. The button is shown only when the device has enough free space; a warning is shown on cellular data.
- **Reading plans** — start, resume, mark days complete, and play a day’s portions as a playlist. Progress is stored locally and can sync across devices.
- **Lock screen and car controls** — play, pause, next, previous, and seek go through the Media Session API (notification shade, headset, Bluetooth head unit).
- **Continuous chapters** — the next chapter is pre-downloaded into a blob and started on a second `<audio>` element *before* the current one finishes, so mobile browsers do not treat the handoff as a new autoplay (which they would block).
- **Bible text beside the audio** — when you pick chapters on Home, the matching text is shown while it plays.
- **Daily verse reminder** — optional Web Push, once a day, in the language of the selected Bible.
- **Optional sign-in (Google or Apple)** — plan progress and completion counts sync through Firestore. The app works fully without an account.

## Languages and translations

The app uses the **Open Translation Bible (OTB)** (see [Credits](#credits)). Portuguese is narrated in full, with two voices (Ariel and Lucas), and is the only entry of `BUNDLED_CATALOG`. The OTB text also exists in English, Spanish, Chinese and Japanese, offered once it has narration.

UI strings follow the selected Bible language (`public/assets/i18n/`).

The Bibles on offer come from a list, not from looking at the CDN (it can't list its own files). The list exists twice: `BUNDLED_CATALOG` in `src/app/data/bible-catalog.ts` ships inside the app, and `catalog.json` at the root of the CDN is the copy that is edited from then on — see [The list on the CDN](#the-list-on-the-cdn-catalogjson). The first entry of a language that is not `hidden` is its default. On first run (and after a language reset) the picker lists languages by name; a language with one visible version opens it straight away, and one with two or more then lists them and the Bible opens only after one is chosen. A language with two or more visible entries also gets a version switch (Home and Settings); a version with two or more `narrators` gets a narrator switch (Settings and the player) and keeps each narrator's audio in its own CDN folder and under its own download key.

### The list on the CDN (`catalog.json`)

```json
{
  "bibles": [
    { "lang": "pt", "version": "otb", "flag": "🇧🇷", "label": "Português - OTB",
      "narrators": [{ "id": "ariel", "label": "Ariel" }, { "id": "lucas", "label": "Lucas" }] },
    { "lang": "en", "version": "otb", "flag": "🇺🇸", "label": "English - OTB", "hidden": true }
  ]
}
```

**`hidden`** (optional, `true` or `false`): a hidden version is not offered anywhere — not in the language picker, not in the version switch of Home or Settings. A device that already has it selected keeps opening it (Settings shows it as the current value but does not offer it, and the switch lets the user move to a visible version). The default of a language is its first version that is not hidden, and a language whose versions are all hidden is not offered at all. Use it to upload a version and try it on your own device (select it before hiding it) before offering it, or to stop offering one without breaking it for people who use it. Hiding does not change audio paths or download keys.

It lives at `{BIBLE_CDN_URL}/catalog.json`. **Adding a version or a narrator needs no app update of any kind, not even over the air**: upload the files, add the entry to this file, upload it. `CatalogService` reads it every time the app opens or comes back with a connection (at most every 5 minutes), and a list that differs from the one in use replaces it, is saved on the device (`localStorage.bibleCatalog`) and repaints the open pages. A device that has never been online uses the bundled list.

What protects the apps from a bad edit:

- The whole file is ignored, and the app keeps the list it has, when anything in it is malformed or repeated: `lang` must be 2–3 lowercase letters, `version` lowercase letters/digits, `label` non-empty, a narrator `id` lowercase letters, digits, `-` or `_`, with a non-empty `label`, `hidden`, when present, a boolean (`"true"` or `1` reject the file), and `formats`, when present, a non-empty list of distinct strings. Validate the JSON before uploading.
- The version a device has selected stays available on that device even if the file drops it. A narrator that is removed is simply no longer offered: whoever used it goes back to the version's first voice.
- **A new language is not only data.** The interface texts (`public/assets/i18n/{lang}.json`) ship inside the app, so an entry in a language missing from `UI_LANGUAGES` is skipped until an app update (over the air) adds its texts and the language to that constant.

Keep `BUNDLED_CATALOG` reasonably close to the file (update it when the app is being released anyway): it is what a first run without a connection sees.

### Versions and narrators: where the files go

Everything is on the CDN (Cloudflare R2, `BIBLE_CDN_URL` in `src/app/services/bible.service.ts`). `{lang}` is lowercase (`pt`), `{VERSION}` uppercase in audio paths (`OTB`) and lowercase in the JSON name, `{ISO}` is the book's three-letter code (`GEN`, `EXO`, `PSA`…), and the file name has a space: `GEN 1.m4a`.

| What | Path on the CDN |
|---|---|
| Text | `jsons/{lang}-{version}.json` |
| Audio, the version's **default** voice (first narrator, or none) | `audios/{lang}/{VERSION}/{ISO}/{ISO} {chapter}.{ext}` |
| Audio, **any other** voice | `audios/{lang}/{VERSION}/{narratorId}/{ISO}/{ISO} {chapter}.{ext}` |
| Sample (optional), default voice / other voice | `audios/{lang}/{VERSION}/sample.mp3` / `audios/{lang}/{VERSION}/{narratorId}/sample.mp3` |
| The list of versions and narrators | `catalog.json` |

A narrator belongs to a **version**, not to a language. The default voice has **no** folder of its own, so giving a version a second voice moves and copies nothing: the new voice goes in its folder next to the existing files.

```
audios/pt/OTB/GEN/GEN 1.m4a          ← Ariel, the default voice
audios/pt/OTB/lucas/GEN/GEN 1.m4a    ← Lucas
```

```json
{ "lang": "pt", "version": "otb", "flag": "🇧🇷", "label": "Português - OTB",
  "formats": ["opus", "mp3"],
  "narrators": [{ "id": "ariel", "label": "Ariel" }, { "id": "lucas", "label": "Lucas" }] }
```

**Formats.** `formats` lists what each chapter exists in, best first (`AUDIO_FORMATS` in `bible-catalog.ts`): `opus` is Opus 32 kbps mono in an MP4 container, `.m4a` (about a quarter of a 128 kbps MP3); `mp3` is `.mp3`. Every format listed must exist for **every** chapter of every voice, side by side with the same name (`GEN 1.m4a` and `GEN 1.mp3`). A device downloads the first one it plays; without `formats` it is mp3, as before. Whether a device plays Opus is found out by **playing** a fraction of a second of embedded silence (`utils/audio-format-probe.ts`), never by asking `canPlayType`: Safari says no on iPhones that play it fine. Older iPhones that really can't get the mp3. A format the app doesn't know is skipped, so a newer catalog can add one; an entry left with none it knows is left out. Encoding, from the original:

```
ffmpeg -i in.mp3 -c:a libopus -b:a 32k -application voip -map_metadata -1 -f mp4 "GEN 1.m4a"
ffmpeg -i in.mp3 -c:a libmp3lame -b:a 48k -ac 1 -map_metadata -1 "GEN 1.mp3"
```

(`-f mp4` is needed: ffmpeg's `.m4a` muxer refuses Opus.) On the device the file keeps its extension (`audio-storage.ts`), because AVPlayer reads a local file by its extension.

**A new version of a language**: upload `jsons/{lang}-{version}.json` and the audio, then add the entry to `catalog.json`. The first entry of a language is its default; add `"hidden": true` to upload it without offering it yet.

Rules:

- `id` is the folder name and part of the download key: lowercase ASCII, no spaces, never renamed once people have downloaded it.
- Keep the default narrator **first**, and never change who is first: their files are the folder-less ones, and chapters downloaded while the version had a single voice were stored without a narrator in their key, which the app reuses only for the first narrator.
- Chapters saved by the oldest app versions under a name-only key (`Gênesis 1.mp3`) are trusted only for the five versions that existed then (`hasNameOnlyKeys`), whatever order the list is in.
- On the device each voice is a separate set of files. The key is `{version}-{abbrev}-{chapter}` with no choice of narrator and `{version}-{narratorId}-{abbrev}-{chapter}` with one (`trackId` in `bible.service.ts`), so two voices never share a file and both can stay downloaded.

**A voice still being narrated.** A narrator may list the books it has so far, and the sizes of the whole voice per format (optional; without them the size is estimated per chapter):

```json
{ "id": "ariel", "label": "Ariel", "books": ["GEN", "LEV"], "bytes": { "opus": 54000000, "mp3": 81000000 } }
```

Only those books are downloaded, and "complete" means all of them; the others show dimmed in the picker and simply have no audio yet. When a book is ready: upload it, add its code to `books`, update `bytes`. Once the whole Bible is narrated, drop `books`. No app update for any of it.

**Replacing a book's audio after it was published** (a fix, silence added at the start…). Upload the new files over the old ones (same names) and raise the book's revision in that voice's `rev`, by ISO code; a book not listed is at revision 1:

```json
{ "id": "ariel", "label": "Ariel", "rev": { "GEN": 2, "EXO": 2 } }
```

Streaming gets the new file at once (the CDN sends no cache headers). A chapter already on the device at a lower revision keeps playing as it is, and the first time it is looked up to play with a connection the new file is fetched in the background, one chapter at a time, and replaces it once complete (`AudioDownloaderService.localUrl`); the next time it plays the new one. If that fails the old file stays and it is tried again later. The revision each chapter was downloaded at is kept in `localStorage` (`storage/audio-revs.ts`, only entries above 1); if that is lost, the republished chapters are fetched once more.

What the user sees with two or more narrators:

- A narrator switch in Settings and in the player (the saved choice is per version, `PreferencesService.narratorFor`).
- The picker's "downloaded" marks and the **Download the entire Bible** button follow the voice in use: the button shows while that voice is incomplete on the device, so it comes back after switching to a voice that is not downloaded.
- **Download the entire Bible** (Home) opens a dialog with a checkbox per voice (`NarratorChoiceDialog`, flow in `VoiceDownloadService`): the size each still needs, the total and, on the web, the free space; at least one must be ticked, and ticking several downloads them one after the other in a single batch. Voices already complete show as such. Each voice has a play button that plays at most 15 seconds of it, from the first of these that works: the narrator's own `sample.mp3` (optional), Genesis 1 in that voice from the device, and Genesis 1 streamed from the CDN — so Genesis 1 must exist for every narrator listed. If the voice in use is neither on the device nor ticked, the first voice ticked becomes the voice in use.
- The button disappears from Home once **one** voice is complete on the device. More voices are downloaded from Settings (**Download another voice**, same dialog), where each voice on the device can also be removed.
- The narrator switch (Settings, player) marks the voices on the device with ✓, and offline only those can be chosen.
- Nothing is ever deleted to make room: a download that doesn't fit is refused (web) or fails (native), never paid for with another voice's chapters.

Adding a version or a narrator is an edit of `catalog.json` on the CDN: no app release, no over-the-air bundle.

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
- **Settings** — storage usage, clear downloaded audio, reset language, sign-in, daily reminders, app version.

A global mini-player (skip ±10s, previous/next, seek) stays on screen while something is playing.

## How playback works

Audio files are fetched from a Cloudflare R2 CDN (see [where the files go](#versions-and-narrators-where-the-files-go)) and stored as blobs in IndexedDB (`audio-db` → `files`). Bible JSON, plan state, an analytics queue, and plan completion counts use the same database.

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
| Playback | `WebAudioEngine` — two `<audio>` elements + the locked-screen workarounds described in [How playback works](#how-playback-works) | `NativeAudioEngine` — the whole playlist goes to the OS player via [`@dwbn/capacitor-plugin-playlist`](https://www.npmjs.com/package/@dwbn/capacitor-plugin-playlist): Media3/ExoPlayer foreground service on Android, AVQueuePlayer on iOS. Lock screen, notification, headset and car Bluetooth controls are native. |
| Downloaded chapters | IndexedDB blobs | Files in the app's data dir (`audios/*.m4a` / `*.mp3`), downloaded with the native HTTP stack (`@capacitor/file-transfer`), so the OS player can open them and downloads continue in the background |
| Bible JSON | `fetch` with progress | native HTTP (no CORS) |
| Google sign-in | Firebase popup | native account picker (`@capacitor-firebase/authentication`), then the same Firebase JS SDK/Firestore sync |
| Daily verse | Web Push from the Vercel cron | 30 days of local notifications scheduled on the device, with verses from the downloaded Bible (works offline, no FCM/APNs needed) |
| Service worker, install banner, Safari/Instagram warnings | yes | off |

Plugins that live in this repo rather than in npm (`src/app/native/`):

- `BulkDownload` (Android, `BulkDownloadPlugin.java` + `BulkDownloadService.java`): the full-Bible download as a foreground service.
- `DeviceVolume` (Android `DeviceVolumePlugin.java`, iOS `DeviceVolumePlugin.swift`): the media volume, so tapping play with it almost at zero shows "volume too low" (`VolumeCheckService`). No permission. Shells without it simply don't warn.

They are registered by hand: Android in `MainActivity.onCreate`, iOS in `MainViewController.capacitorDidLoad` (the storyboard's view controller). A new iOS file must also be added to the App target in `project.pbxproj`.

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

### App ids

Android uses `live.nlabs.biblia` (`live.nlabs.bible` is permanently taken on Google Play by an old app); the Java namespace and the iOS bundle id are `live.nlabs.bible`.

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

The web app is deployed on Vercel (bible-audio2.vercel.app) on every push to `master`. The landing site (biblia.nlabs.live / bible.nlabs.live) is separate: see `site/build.py`. The production build registers `ngsw-worker.js`. The store apps read their over-the-air updates from `bible-audio2.vercel.app/ota/` (see [Versions and updates](#versions-and-updates)).

The daily-reminder function (`api/send-daily-reminder.ts`) needs these Vercel environment variables (not committed), set on the Vercel project:

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Vercel Cron `Authorization` bearer token |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push VAPID pair (public key also in `environment.ts`) |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin JSON, as a string |
| `ENABLE_DAILY_REMINDER_CRON` | Must be `true` for the cron to send the daily push |

`api/plan-stats.ts` keeps the global per-plan counters (`planStats/{planId}`: `starts`, `completions`, `listens`) behind the "most listened" sort. It only needs `FIREBASE_SERVICE_ACCOUNT`. It is public by design and accepts nothing but `{ planId, event }` for a known plan. The native apps call it at `environment.apiOrigin`.

Sign in with Apple on the web needs the Apple provider configured in Firebase first: see [docs/apple-sign-in-web.md](docs/apple-sign-in-web.md).

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

## Credits

- **Bible text:** the [Open Translation Bible (OTB)](https://openbible.uk), by the Open Translation Bible project — website [openbible.uk](https://openbible.uk), source [github.com/OpenTranslationBible/open-bible](https://github.com/OpenTranslationBible/open-bible). Licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Thank you for making the Scriptures freely available.
- **Store badges:** Google Play and the Google Play logo are trademarks of Google LLC. App Store and the Apple logo are trademarks of Apple Inc.

## License

The app's code is released under the [MIT License](LICENSE). The Bible text is the [Open Translation Bible](https://openbible.uk) and keeps its own licence, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the MIT License does not cover it.
