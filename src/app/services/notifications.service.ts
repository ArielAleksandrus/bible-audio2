import { Injectable } from '@angular/core';
import { SwPush } from '@angular/service-worker';

import { firebaseEnabled, getFirestoreDb } from '../storage/firebase';
import { environment } from '../../environments/environment';

const DEVICE_ID_KEY = 'pushDeviceId';
const SUBSCRIBED_KEY = 'pushSubscribed';

// Daily Bible-verse reminder push notifications. Entirely optional — no
// account needed; each device gets a random local id used only to key its
// own Firestore subscription document (the data isn't sensitive enough to
// warrant tying it to a signed-in user).
//
// iOS note: Safari only supports web push from iOS 16.4+, and only for a
// PWA the user has added to the home screen — a normal browser tab can
// never receive push notifications there. isIosSafariNotInstalled() lets
// the UI show that requirement instead of a silently-broken toggle.
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  readonly enabled = firebaseEnabled;

  constructor(private swPush: SwPush) {}

  get supported(): boolean {
    return this.enabled && this.swPush.isEnabled;
  }

  get isIosSafariNotInstalled(): boolean {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
    return isIos && !isStandalone;
  }

  get isSubscribed(): boolean {
    return localStorage.getItem(SUBSCRIBED_KEY) === 'true';
  }

  async subscribe(language: string): Promise<void> {
    if (!this.supported) throw new Error('Push notifications are not supported here');

    const subscription = await this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
    const db = await getFirestoreDb();
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'push_subscriptions', this.deviceId()), {
      subscription: subscription.toJSON(),
      language,
      updatedAt: Date.now(),
    });
    localStorage.setItem(SUBSCRIBED_KEY, 'true');
  }

  async unsubscribe(): Promise<void> {
    if (this.enabled) {
      try {
        const db = await getFirestoreDb();
        const { doc, deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'push_subscriptions', this.deviceId()));
      } catch (err) {
        console.warn('NotificationsService: failed to delete subscription doc', err);
      }
    }
    if (this.swPush.isEnabled) {
      await this.swPush.unsubscribe().catch(err => console.warn('NotificationsService: unsubscribe failed', err));
    }
    localStorage.removeItem(SUBSCRIBED_KEY);
  }

  private deviceId(): string {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }
}
