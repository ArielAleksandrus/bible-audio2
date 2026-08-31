import type { FirebaseApp } from 'firebase/app';
import { environment } from '../../environments/environment';

// Sign-in/cloud sync are entirely optional: without a real Firebase project
// configured (environment.firebaseConfig.apiKey), AuthService/SyncService
// no-op and the Firebase SDK is never even downloaded.
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
