import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular';
import { filter, take } from 'rxjs';

import { AudioService } from './audio.service';
import { NotificationsService } from './notifications.service';
import { isNativeApp, nativePlatform } from '../utils/platform.util';

/**
 * Native-only app chrome: status bar, splash screen, Android back button,
 * notification permission and reminder top-up. A no-op on the web.
 */
@Injectable({ providedIn: 'root' })
export class NativeShellService {
  private router = inject(Router);
  private platform = inject(Platform);
  private audio = inject(AudioService);
  private notifications = inject(NotificationsService);

  constructor() {
    if (!isNativeApp()) return;
    void this.setup();
  }

  private async setup(): Promise<void> {
    const [{ StatusBar, Style }, { SplashScreen }, { App }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
      import('@capacitor/app'),
    ]);

    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    if (nativePlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0f3d3e' }).catch(() => {});
    }
    await SplashScreen.hide().catch(() => {});

    // Hardware back (Android). Ionic closes open modals/alerts itself at a
    // higher priority; this only runs when nothing else handled it. The
    // empty Capacitor listener turns off its default "WebView history back /
    // exit app" so the two don't both act on one press.
    await App.addListener('backButton', () => {});
    this.platform.backButton.subscribeWithPriority(-1, () => {
      if (!this.router.url.startsWith('/home')) {
        void this.router.navigateByUrl('/home');
      } else {
        // Like Spotify: back on the home tab sends the app to the
        // background instead of killing it (and the chapter playing).
        void App.minimizeApp();
      }
    });

    // Android 13+ only shows the media notification (lock screen / shade
    // controls) with POST_NOTIFICATIONS. Ask the first time something plays,
    // when the reason is obvious, rather than on first launch.
    if (nativePlatform() === 'android') {
      this.audio.isPlaying$.pipe(filter(Boolean), take(1)).subscribe(async () => {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
          await LocalNotifications.requestPermissions().catch(() => {});
        }
      });
    }

    // Tapping a daily-verse notification opens Home.
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.addListener('localNotificationActionPerformed', action => {
      const url = action.notification.extra?.url;
      if (typeof url === 'string') void this.router.navigateByUrl(url);
    });

    await this.notifications.rescheduleIfSubscribed();
  }
}
