import { Injectable } from '@angular/core';
import type { Auth, User } from 'firebase/auth';
import { BehaviorSubject } from 'rxjs';

import { firebaseEnabled, getFirebaseApp } from '../storage/firebase';
import { isNativeApp } from '../utils/platform.util';

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
    const { signInWithCredential, signInWithPopup, GoogleAuthProvider } = await this.getAuthModule();
    const result = isNativeApp()
      ? await signInWithCredential(auth, (await this.nativeCredential('google.com')).credential)
      : await signInWithPopup(auth, new GoogleAuthProvider());
    this.user$.next(result.user);
  }

  // iOS only. App Store guideline 4.8 requires Sign in with Apple next to
  // Google sign-in. Same flow as native Google: the OS sheet returns an ID
  // token (+ the raw nonce it was issued for) and the JS SDK signs in with it.
  async signInWithApple(): Promise<void> {
    if (!this.enabled) return;
    const auth = await this.getAuth();
    const { signInWithCredential } = await this.getAuthModule();
    const result = await signInWithCredential(auth, (await this.nativeCredential('apple.com')).credential);
    this.user$.next(result.user);
  }

  // In-app account deletion (App Store guideline 5.1.1(v)). The user signs in
  // again first: Firebase only deletes an account after a recent login, and
  // for Apple that fresh login also yields the authorization code used to
  // revoke the app's Apple tokens. `deleteData` runs after that login and
  // before the account goes, while Firestore still accepts the user's token.
  async deleteAccount(deleteData: (uid: string) => Promise<void>): Promise<void> {
    if (!this.enabled) return;
    const auth = await this.getAuth();
    const user = auth.currentUser;
    if (!user) return;
    const { deleteUser, reauthenticateWithCredential, reauthenticateWithPopup, revokeAccessToken, GoogleAuthProvider } =
      await this.getAuthModule();

    const providerId = user.providerData[0]?.providerId === 'apple.com' ? 'apple.com' : 'google.com';
    let appleAuthCode: string | undefined;
    if (isNativeApp()) {
      const native = await this.nativeCredential(providerId);
      appleAuthCode = native.appleAuthCode;
      await reauthenticateWithCredential(user, native.credential);
    } else {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
    }

    await deleteData(user.uid);

    // Needs the Apple provider's OAuth code-flow settings (Services ID + key)
    // in Firebase; without them it fails and the account is still deleted.
    if (appleAuthCode) {
      await revokeAccessToken(auth, appleAuthCode).catch(err =>
        console.warn('AuthService: Apple token revocation failed', err));
    }

    await deleteUser(user);
    this.user$.next(null);
    if (isNativeApp()) {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      await FirebaseAuthentication.signOut().catch(() => {});
    }
  }

  // Native OS sign-in sheet (Google Sign-In / Credential Manager, or Sign in
  // with Apple) → a Firebase credential for the JS SDK.
  private async nativeCredential(providerId: 'google.com' | 'apple.com') {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const { GoogleAuthProvider, OAuthProvider } = await this.getAuthModule();
    if (providerId === 'google.com') {
      const native = await FirebaseAuthentication.signInWithGoogle();
      const idToken = native.credential?.idToken;
      if (!idToken) throw new Error('Google sign-in returned no ID token');
      return { credential: GoogleAuthProvider.credential(idToken, native.credential?.accessToken) };
    }
    const native = await FirebaseAuthentication.signInWithApple();
    const idToken = native.credential?.idToken;
    if (!idToken) throw new Error('Apple sign-in returned no ID token');
    return {
      credential: new OAuthProvider('apple.com').credential({ idToken, rawNonce: native.credential?.nonce }),
      appleAuthCode: native.credential?.authorizationCode,
    };
  }

  async signOut(): Promise<void> {
    if (!this.enabled) return;
    const auth = await this.getAuth();
    const { signOut } = await this.getAuthModule();
    await signOut(auth);
    if (isNativeApp()) {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
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
