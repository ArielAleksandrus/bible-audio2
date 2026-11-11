import type { CapacitorConfig } from '@capacitor/cli';

// Native (Android/iOS) shell around the same Angular build that ships as the
// PWA. `npm run build` → `npx cap sync` copies dist/…/browser into the native
// projects. See README "Apps nativos" for the full workflow.
//
// appId is the store identity (Play Store package name / iOS bundle id) and
// can't be changed once the app is published — confirm it before the first
// upload to either store.
const config: CapacitorConfig = {
  appId: 'live.nlabs.biblia',
  appName: 'Bíblia Narrada',
  webDir: 'dist/bible-audio2/browser',
  android: {
    // Chapter MP3s and the Bible JSON come from the R2 CDN over https.
    allowMixedContent: false,
  },
  experimental: {
    ios: {
      spm: {
        swiftToolsVersion: '6.1',
        // Google Sign-In only; leaves the Facebook SDK out of the binary.
        packageTraits: {
          '@capacitor-firebase/authentication': ['Google'],
        },
        // Avoids a SwiftPM package-identity collision with firebase-ios-sdk
        // (capawesome-team/capacitor-firebase#959).
        packageOptions: {
          '@capacitor-firebase/authentication': { symlink: true },
        },
      },
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0f3d3e',
      showSpinner: false,
    },
    FirebaseAuthentication: {
      // Native Google sign-in only hands us an ID token; the Firebase JS SDK
      // signs in with it so Firestore sync keeps using the same code as web.
      skipNativeAuth: true,
      providers: ['google.com', 'apple.com'],
    },
    // New versions over the air, in manual mode and without Capgo's cloud:
    // the app reads the manifest deployed with the web app and downloads the
    // bundle itself (src/app/services/ota.service.ts); nothing is sent to
    // Capgo (empty statsUrl). A bundle that failed to open is kept, marked as
    // failed, so it is not downloaded again.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
      autoDeleteFailed: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notification',
      iconColor: '#0f3d3e',
    },
  },
};

export default config;
