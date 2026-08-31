import { Injectable } from '@angular/core';
import type { Auth, User } from 'firebase/auth';
import { BehaviorSubject } from 'rxjs';

import { firebaseEnabled, getFirebaseApp } from '../storage/firebase';

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
  async signInWithGoogle(): Promise<void> {
    if (!this.enabled) return;
    const auth = await this.getAuth();
    const { GoogleAuthProvider, signInWithPopup } = await this.getAuthModule();
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    this.user$.next(result.user);
  }

  async signOut(): Promise<void> {
    if (!this.enabled) return;
    const auth = await this.getAuth();
    const { signOut } = await this.getAuthModule();
    await signOut(auth);
  }

  private getAuthModule() {
    if (!this.authModule) this.authModule = import('firebase/auth');
    return this.authModule;
  }

  private async getAuth(): Promise<Auth> {
    if (!this.authPromise) {
      this.authPromise = (async () => {
        const app = await getFirebaseApp();
        const { getAuth } = await this.getAuthModule();
        return getAuth(app);
      })();
    }
    return this.authPromise;
  }
}
