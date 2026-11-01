import { Injectable } from '@angular/core';
import { SwPush } from '@angular/service-worker';

import { firebaseEnabled, getFirestoreDb } from '../storage/firebase';
import { getBibleVersion } from '../storage/my-db';
import { environment } from '../../environments/environment';
import { isNativeApp } from '../utils/platform.util';
import { VerseService } from './verse.service';
import { capacitorPlugins } from '../utils/capacitor-plugins';

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
//
// Native apps: no push server involved at all. The next NATIVE_DAYS days of
// reminders are scheduled as *local* notifications, each with a verse taken
// from the Bible already on the device — works offline, needs no FCM/APNs
// setup, and the reference is shown in the user's own language. The window
// is topped up every time the app starts (rescheduleIfSubscribed()).
const NATIVE_DAYS = 30;
const NATIVE_ID_BASE = 7000;
const NATIVE_HOUR = 10; // local time, close to the web cron (13:00 UTC ≈ 10:00 BRT)

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  readonly native = isNativeApp();
  readonly enabled = this.native || firebaseEnabled;

  constructor(private swPush: SwPush, private verseServ: VerseService) {}

  get supported(): boolean {
    if (this.native) return true;
    return this.enabled && this.swPush.isEnabled;
  }

  get isIosSafariNotInstalled(): boolean {
    if (this.native) return false;
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
    if (this.native) {
      await this.scheduleNative(true);
      localStorage.setItem(SUBSCRIBED_KEY, 'true');
      return;
    }

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
    if (this.native) {
      await this.cancelNative();
      localStorage.removeItem(SUBSCRIBED_KEY);
      return;
    }
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

  /** Native: keep the scheduled window full. Call on app start. */
  async rescheduleIfSubscribed(): Promise<void> {
    if (!this.native || !this.isSubscribed) return;
    await this.scheduleNative(false).catch(err => console.warn('NotificationsService: reschedule failed', err));
  }

  private async scheduleNative(askPermission: boolean): Promise<void> {
    const { LocalNotifications } = await capacitorPlugins.localNotifications();
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted' && askPermission) perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') throw new Error('Notification permission not granted');

    const selected = localStorage.getItem('selectedBible') || '';
    const saved = selected ? await getBibleVersion(selected) : null;
    const verses = saved?.data
      ? await this.verseServ.deriveVerses(saved.data)
      : await this.verseServ.getEnglishVerses();
    if (verses.length === 0) return;

    await this.cancelNative();

    const first = new Date();
    first.setHours(NATIVE_HOUR, 0, 0, 0);
    if (first.getTime() <= Date.now()) first.setDate(first.getDate() + 1);

    const notifications = Array.from({ length: NATIVE_DAYS }, (_, i) => {
      const at = new Date(first);
      at.setDate(first.getDate() + i);
      const verse = verses[Math.floor(Math.random() * verses.length)];
      const book = saved?.data?.books?.[verse.book]?.name;
      const ref = book ? `${book} ${verse.chapter}:${verse.verse}` : verse.ref;
      return {
        id: NATIVE_ID_BASE + i,
        title: 'Bíblia Narrada',
        body: `"${verse.text}" — ${ref}`,
        largeBody: `"${verse.text}" — ${ref}`,
        schedule: { at, allowWhileIdle: true },
        // A daily verse doesn't need to land on the exact minute; asking for an
        // exact alarm would send the user to the "Alarms & reminders" settings.
        isExactNotification: false,
        extra: { url: '/home' },
      };
    });
    await LocalNotifications.schedule({ notifications });
  }

  private async cancelNative(): Promise<void> {
    const { LocalNotifications } = await capacitorPlugins.localNotifications();
    const ids = Array.from({ length: NATIVE_DAYS }, (_, i) => ({ id: NATIVE_ID_BASE + i }));
    await LocalNotifications.cancel({ notifications: ids }).catch(() => {});
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
