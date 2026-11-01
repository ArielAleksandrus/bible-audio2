import type { User } from 'firebase/auth';

import { AuthService } from './auth.service';
import { capacitorPlugins } from '../utils/capacitor-plugins';
import { runOnPlatform } from '../../testing/fake-capacitor';

/**
 * The Firebase JS SDK would talk to Google; AuthService loads it through
 * two private lazy getters, which are replaced here with an in-memory fake.
 */
function fakeFirebaseAuth() {
  let listener: ((u: User | null) => void) | null = null;
  const auth = { name: 'fake-auth' };
  const mod = {
    onAuthStateChanged: vi.fn((_a: unknown, fn: (u: User | null) => void) => { listener = fn; }),
    GoogleAuthProvider: Object.assign(vi.fn(), {
      credential: vi.fn((idToken: string, accessToken?: string) => ({ idToken, accessToken })),
    }),
    signInWithCredential: vi.fn(async (_a: unknown, cred: { idToken: string }) => ({ user: { uid: `u-${cred.idToken}` } as User })),
    signInWithPopup: vi.fn(async () => ({ user: { uid: 'u-popup' } as User })),
    signOut: vi.fn(async () => { listener?.(null); }),
  };
  const proto = AuthService.prototype as unknown as {
    getAuth(): Promise<unknown>;
    getAuthModule(): Promise<unknown>;
  };
  vi.spyOn(proto, 'getAuth').mockResolvedValue(auth);
  vi.spyOn(proto, 'getAuthModule').mockResolvedValue(mod);
  return { mod, auth, emit: (u: User | null) => listener?.(u) };
}

function fakeNativeGoogle(result: () => Promise<unknown>) {
  const FirebaseAuthentication = {
    signInWithGoogle: vi.fn(result),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  vi.spyOn(capacitorPlugins, 'firebaseAuthentication').mockResolvedValue({ FirebaseAuthentication } as never);
  return FirebaseAuthentication;
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('AuthService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('restores a previous session on start-up', async () => {
    const fb = fakeFirebaseAuth();
    const svc = new AuthService();
    await flush();
    fb.emit({ uid: 'returning' } as User);
    expect(svc.currentUser?.uid).toBe('returning');
  });

  describe('native app', () => {
    beforeEach(() => runOnPlatform('android'));

    it('signs in with the OS Google account picker, then into Firebase with its ID token', async () => {
      const fb = fakeFirebaseAuth();
      const native = fakeNativeGoogle(async () => ({ credential: { idToken: 'tok', accessToken: 'acc' } }));
      const svc = new AuthService();
      await svc.signInWithGoogle();
      expect(native.signInWithGoogle).toHaveBeenCalled();
      expect(fb.mod.GoogleAuthProvider.credential).toHaveBeenCalledWith('tok', 'acc');
      expect(fb.mod.signInWithPopup).not.toHaveBeenCalled(); // Google blocks OAuth popups in WebViews
      expect(svc.currentUser?.uid).toBe('u-tok');
    });

    it('fails without touching Firebase when the picker returns no ID token', async () => {
      const fb = fakeFirebaseAuth();
      fakeNativeGoogle(async () => ({ credential: null }));
      const svc = new AuthService();
      await expect(svc.signInWithGoogle()).rejects.toThrow(/no ID token/);
      expect(fb.mod.signInWithCredential).not.toHaveBeenCalled();
      expect(svc.currentUser).toBeNull();
    });

    it('stays signed out when the user cancels the picker', async () => {
      fakeFirebaseAuth();
      fakeNativeGoogle(async () => { throw new Error('The user canceled the sign-in flow.'); });
      const svc = new AuthService();
      await expect(svc.signInWithGoogle()).rejects.toThrow(/canceled/);
      expect(svc.currentUser).toBeNull();
    });

    it('signs out of Firebase and of the native Google session', async () => {
      const fb = fakeFirebaseAuth();
      const native = fakeNativeGoogle(async () => ({ credential: { idToken: 'tok' } }));
      const svc = new AuthService();
      await svc.signInWithGoogle();
      await svc.signOut();
      expect(fb.mod.signOut).toHaveBeenCalled();
      expect(native.signOut).toHaveBeenCalled();
      expect(svc.currentUser).toBeNull();
    });

    it('still signs out when the native plugin errors', async () => {
      fakeFirebaseAuth();
      const native = fakeNativeGoogle(async () => ({}));
      native.signOut.mockRejectedValue(new Error('no native session'));
      await expect(new AuthService().signOut()).resolves.toBeUndefined();
    });
  });

  describe('web', () => {
    beforeEach(() => runOnPlatform('web'));

    it('signs in with a Google popup and never loads the native plugin', async () => {
      const fb = fakeFirebaseAuth();
      const loadNative = vi.spyOn(capacitorPlugins, 'firebaseAuthentication');
      const svc = new AuthService();
      await svc.signInWithGoogle();
      expect(fb.mod.signInWithPopup).toHaveBeenCalled();
      expect(loadNative).not.toHaveBeenCalled();
      expect(svc.currentUser?.uid).toBe('u-popup');

      await svc.signOut();
      expect(loadNative).not.toHaveBeenCalled();
    });
  });
});
