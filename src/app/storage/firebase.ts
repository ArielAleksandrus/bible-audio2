import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';

// Sign-in/cloud sync are entirely optional: without a real Firebase project
// configured (environment.firebaseConfig.apiKey), AuthService/SyncService/
// VerseService/NotificationsService no-op and the Firebase SDK is never
// even downloaded.
export const firebaseEnabled = !!environment.firebaseConfig?.apiKey;

let appPromise: Promise<FirebaseApp> | null = null;

// Lazily loads and initializes the Firebase app exactly once. Kept behind a
// dynamic import so the SDK stays out of the main bundle for the (likely
// common) case where nobody signs in.
export function getFirebaseApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = import('firebase/app').then(({ initializeApp }) => initializeApp(environment.firebaseConfig));
  }
  return appPromise;
}

let dbPromise: Promise<Firestore> | null = null;

// Single shared Firestore instance, initialized exactly once with a
// persistent local cache. Every caller (SyncService, VerseService,
// NotificationsService) MUST go through this rather than calling
// getFirestore()/initializeFirestore() themselves — Firestore throws if
// initializeFirestore() runs after the instance has already been created
// via a plain getFirestore() call, so a shared entry point avoids that race.
export function getFirestoreDb(): Promise<Firestore> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const app = await getFirebaseApp();
      const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } = await import('firebase/firestore');
      return initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
    })();
  }
  return dbPromise;
}
