import { TestBed } from '@angular/core/testing';
import { SwPush } from '@angular/service-worker';

import { NotificationsService } from './notifications.service';
import { VerseEntry, VerseService } from './verse.service';
import { dbPromise } from '../storage/my-db';
import { capacitorPlugins } from '../utils/capacitor-plugins';
import { runOnPlatform } from '../../testing/fake-capacitor';

const verse = (book: number, chapter: number, n: number, text: string): VerseEntry =>
  ({ book, abbrev: 'x', chapter, verse: n, ref: `EN ${chapter}:${n}`, theme: 'love', text });

interface Scheduled {
  id: number; title: string; body: string;
  schedule: { at: Date; allowWhileIdle: boolean };
  extra: { url: string };
}

/** In-memory LocalNotifications with a permission the test controls. */
function fakeLocalNotifications(initial: 'granted' | 'denied' | 'prompt' = 'prompt', onRequest: 'granted' | 'denied' = 'granted') {
  const state = { permission: initial as string, pending: new Map<number, Scheduled>() };
  const LocalNotifications = {
    checkPermissions: vi.fn(async () => ({ display: state.permission })),
    requestPermissions: vi.fn(async () => { state.permission = onRequest; return { display: onRequest }; }),
    schedule: vi.fn(async ({ notifications }: { notifications: Scheduled[] }) => {
      for (const n of notifications) state.pending.set(n.id, n);
    }),
    cancel: vi.fn(async ({ notifications }: { notifications: { id: number }[] }) => {
      for (const n of notifications) state.pending.delete(n.id);
    }),
  };
  vi.spyOn(capacitorPlugins, 'localNotifications').mockResolvedValue(
    { LocalNotifications } as unknown as Awaited<ReturnType<typeof capacitorPlugins.localNotifications>>);
  return { state, LocalNotifications };
}

describe('NotificationsService', () => {
  let verses: { getEnglishVerses: ReturnType<typeof vi.fn>; deriveVerses: ReturnType<typeof vi.fn> };
  let swPush: { isEnabled: boolean; requestSubscription: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> };

  function create(): NotificationsService {
    TestBed.configureTestingModule({
      providers: [
        { provide: VerseService, useValue: verses },
        { provide: SwPush, useValue: swPush },
      ],
    });
    return TestBed.inject(NotificationsService);
  }

  beforeEach(async () => {
    localStorage.clear();
    await (await dbPromise).clear('bibles');
    verses = {
      getEnglishVerses: vi.fn().mockResolvedValue([verse(42, 3, 16, 'For God so loved the world')]),
      deriveVerses: vi.fn().mockResolvedValue([verse(42, 3, 16, 'Porque Deus amou o mundo')]),
    };
    swPush = { isEnabled: false, requestSubscription: vi.fn(), unsubscribe: vi.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('native app (local notifications)', () => {
    beforeEach(() => runOnPlatform('android'));

    it('is always available and never shows the iOS "add to home screen" hint', () => {
      const svc = create();
      expect(svc.supported).toBe(true);
      expect(svc.isIosSafariNotInstalled).toBe(false);
      expect(svc.isSubscribed).toBe(false);
    });

    it('asks for permission and schedules 30 daily reminders at 10:00, starting tomorrow when 10:00 has passed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 4, 30, 15, 0)); // 30 May, 15:00 local
      const { state, LocalNotifications } = fakeLocalNotifications('prompt', 'granted');
      const svc = create();

      await svc.subscribe('en');

      expect(LocalNotifications.requestPermissions).toHaveBeenCalled();
      expect(svc.isSubscribed).toBe(true);
      const days = [...state.pending.values()].map(n => n.schedule.at);
      expect(days).toHaveLength(30);
      expect(days[0]).toEqual(new Date(2026, 4, 31, 10, 0));
      expect(days[1]).toEqual(new Date(2026, 5, 1, 10, 0)); // across the month boundary
      expect(days[29]).toEqual(new Date(2026, 5, 29, 10, 0));
      const first = [...state.pending.values()][0];
      expect(first.body).toBe('"For God so loved the world" — EN 3:16');
      expect(first.extra.url).toBe('/home');
    });

    it('starts today when it is still before 10:00', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 0, 10, 7, 30));
      const { state } = fakeLocalNotifications('granted');
      await create().subscribe('en');
      expect([...state.pending.values()][0].schedule.at).toEqual(new Date(2026, 0, 10, 10, 0));
    });

    it("uses verses from the Bible on the device, with the book name in the user's language", async () => {
      localStorage.setItem('selectedBible', 'pt-ARA');
      const books = Array.from({ length: 66 }, (_, i) => ({ name: `Livro ${i}` }));
      books[42] = { name: 'João' };
      await (await dbPromise).put('bibles', {
        id: 'pt-ARA', version: 'ARA', language: 'pt', fullName: 'Almeida', data: { books }, downloadedAt: 1,
      });
      const { state } = fakeLocalNotifications('granted');
      await create().subscribe('pt');
      expect(verses.deriveVerses).toHaveBeenCalled();
      expect([...state.pending.values()][0].body).toBe('"Porque Deus amou o mundo" — João 3:16');
    });

    it('does not subscribe when permission is denied', async () => {
      const { state } = fakeLocalNotifications('prompt', 'denied');
      const svc = create();
      await expect(svc.subscribe('en')).rejects.toThrow(/permission/i);
      expect(svc.isSubscribed).toBe(false);
      expect(state.pending.size).toBe(0);
    });

    it('tops the window back up on app start without prompting, replacing the old reminders', async () => {
      const { state, LocalNotifications } = fakeLocalNotifications('granted');
      const svc = create();
      await svc.subscribe('en');
      const firstBatch = [...state.pending.values()];

      await svc.rescheduleIfSubscribed();
      expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
      expect(state.pending.size).toBe(30);
      expect([...state.pending.keys()]).toEqual(firstBatch.map(n => n.id));
    });

    it('does nothing on app start when the user never subscribed', async () => {
      const { LocalNotifications } = fakeLocalNotifications('granted');
      await create().rescheduleIfSubscribed();
      expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    });

    it('a permission revoked in system settings does not crash app start', async () => {
      const { state } = fakeLocalNotifications('granted');
      const svc = create();
      await svc.subscribe('en');
      state.permission = 'denied';
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(svc.rescheduleIfSubscribed()).resolves.toBeUndefined();
    });

    it('unsubscribing cancels every pending reminder', async () => {
      const { state } = fakeLocalNotifications('granted');
      const svc = create();
      await svc.subscribe('en');
      await svc.unsubscribe();
      expect(state.pending.size).toBe(0);
      expect(svc.isSubscribed).toBe(false);
    });
  });

  describe('web/PWA (web push)', () => {
    beforeEach(() => runOnPlatform('web'));

    it('is unsupported without a service worker and refuses to subscribe', async () => {
      const svc = create();
      expect(svc.supported).toBe(false);
      await expect(svc.subscribe('pt')).rejects.toThrow(/not supported/);
      expect(swPush.requestSubscription).not.toHaveBeenCalled();
    });

    it('is supported once the service worker is enabled', () => {
      swPush.isEnabled = true;
      expect(create().supported).toBe(true);
    });

    it('flags iOS Safari outside the home screen (web push cannot work there)', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1');
      expect(create().isIosSafariNotInstalled).toBe(true);
    });

    it('does not flag other browsers', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile');
      expect(create().isIosSafariNotInstalled).toBe(false);
    });
  });
});
