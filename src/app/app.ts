import { Component, inject, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { IonApp, IonRouterOutlet, ModalController } from '@ionic/angular';

import { InstallPrompt } from './components/install-prompt/install-prompt';
import { NotificationPrompt } from './components/notification-prompt/notification-prompt';
import { InAppBrowserOverlay } from './components/in-app-browser-overlay/in-app-browser-overlay';
import { AnalyticsService } from './services/analytics.service';
import { SyncService } from './services/sync.service';
import { AppStateService } from './services/app-state.service';
import { UpdateService } from './services/update.service';
import { UiService } from './services/ui.service';
import { NativeShellService } from './services/native-shell.service';
import { SafariWarningDialog } from './safari-warning-dialog/safari-warning-dialog';
import { isIosDevice, isInstagramInAppBrowser } from './utils/browser.util';
import { isNativeApp } from './utils/platform.util';
import { registerIcons } from './icons';

registerIcons();

const SAFARI_WARNING_DISMISSED_KEY = 'safariWarningDismissed';

@Component({
  selector: 'app-root',
  imports: [
    AsyncPipe,
    IonApp,
    IonRouterOutlet,
    InstallPrompt,
    NotificationPrompt,
    InAppBrowserOverlay,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('bible-audio2');
  protected readonly native = isNativeApp();

  public appState = inject(AppStateService);
  private translate = inject(TranslateService);
  private updateServ = inject(UpdateService);
  private ui = inject(UiService);
  private modals = inject(ModalController);

  constructor() {
    // Eagerly constructed for their side effects (GA queue flush, Firestore
    // sync on sign-in, status bar / back button / notification setup).
    inject(AnalyticsService);
    inject(SyncService);
    inject(NativeShellService);

    this.updateServ.updateReady$.subscribe(async ready => {
      if (!ready) return;
      const message = this.translate.instant('update_available.message');
      const action = this.translate.instant('update_available.reload');
      if (await this.ui.actionToast(message, action)) this.updateServ.reload();
    });

    this.maybeShowSafariWarning();
  }

  // On iOS, every browser (Safari, Chrome, Firefox) runs on the same WebKit
  // engine under the hood, so none of them can do background audio playback
  // or push notifications with the tab/app in the background — only an
  // installed (Home Screen) PWA can. Desktop Safari's notification/playback
  // gaps are a lower priority, so this only targets phones/tablets.
  private async maybeShowSafariWarning(): Promise<void> {
    if (this.native) return;
    if (localStorage.getItem(SAFARI_WARNING_DISMISSED_KEY) === 'true') return;
    if (!isIosDevice()) return;
    if (this.isRunningStandalone()) return;
    // Instagram's embedded browser has no Share sheet / Add to Home Screen
    // option to point at — the in-app-browser overlay's "open in a real
    // browser" instructions apply instead.
    if (isInstagramInAppBrowser()) return;

    const modal = await this.modals.create({ component: SafariWarningDialog, cssClass: 'app-dialog-tall' });
    await modal.present();
    await modal.onDidDismiss();
    localStorage.setItem(SAFARI_WARNING_DISMISSED_KEY, 'true');
  }

  private isRunningStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  }
}
