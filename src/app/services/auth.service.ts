import { Injectable } from '@angular/core';
import type { Auth, User } from 'firebase/auth';
import { BehaviorSubject } from 'rxjs';

import { firebaseEnabled, getFirebaseApp } from '../storage/firebase';
import { isNativeApp } from '../utils/platform.util';
import { capacitorPlugins } from '../utils/capacitor-plugins';

// Wraps Firebase Auth. Sign-in is entirely optional — the app works fully
// signed out; this only exists to let progress follow the user across devices.
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly enabled = firebaseEnabled;

  user$ = new BehaviorSubject<User | null>(null);
  get currentUser(): User | null {
    return this.user$.value;
  }

  private authPromise: Promise<Auth> | null = null;
  private authModule: Promise<typeof import('firebase/auth')> | null = null;

  constructor() {
    if (!this.enabled) return;

    this.getAuth().then(async auth => {
      const { onAuthStateChanged } = await this.getAuthModule();
      // Restores a previous session (from localStorage/IndexedDB) on app load.
      onAuthStateChanged(auth, user => this.user$.next(user));
    });
  }

  // Popup, not redirect: a full-page redirect through a separate authDomain
  // relies on browser storage surviving the round trip, which Chrome's
  // storage partitioning / Safari ITP can silently break — the Google login
  // succeeds but the app never sees the result. Popup completes in one
  // context with no cross-page state, so it isn't affected.
  //
  // Native apps can't use either: Google blocks OAuth inside embedded
  // WebViews. There the OS account picker (Credential Manager on Android,
  // Google Sign-In on iOS) returns an ID token, and the JS SDK signs in with
  // that — so Firestore sync below runs exactly the same code as on web.
  async signInWithGoogle(): Promise<void> {
    if (!this.enabled) return;
    const auth = await this.getAuth();
    if (isNativeApp()) {
      const { FirebaseAuthentication } = await capacitorPlugins.firebaseAuthentication();
      const { GoogleAuthProvider, signInWithCredential } = await this.getAuthModule();
      const native = await FirebaseAuthentication.signInWithGoogle();
      const idToken = native.credential?.idToken;
      if (!idToken) throw new Error('Google sign-in returned no ID token');
      const result = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken, native.credential?.accessToken));
      this.user$.next(result.user);
      return;
    }
    const { GoogleAuthProvider, signInWithPopup } = await this.getAuthModule();
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    this.user$.next(result.user);
  }

  async signOut(): Promise<void> {
    if (!this.enabled) return;
    const auth = await this.getAuth();
    const { signOut } = await this.getAuthModule();
    await signOut(auth);
    if (isNativeApp()) {
      const { FirebaseAuthentication } = await capacitorPlugins.firebaseAuthentication();
      await FirebaseAuthentication.signOut().catch(() => {});
    }
  }

  private getAuthModule() {
    if (!this.authModule) this.authModule = import('firebase/auth');
    return this.authModule;
  }

  private async getAuth(): Promise<Auth> {
    if (!this.authPromise) {
      this.authPromise = (async () => {
        const app = await getFirebaseApp();
        const { getAuth, initializeAuth, indexedDBLocalPersistence } = await this.getAuthModule();
        // getAuth() also wires up the popup/redirect resolver, which loads
        // Google scripts that hang inside the iOS WebView (capacitor://).
        // Native sign-in doesn't need it — just persistence.
        return isNativeApp()
          ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
          : getAuth(app);
      })();
    }
    return this.authPromise;
  }
}
