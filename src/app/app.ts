import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

import { AudioPlayer } from './components/audio-player/audio-player';
import { InstallPrompt } from './components/install-prompt/install-prompt';
import { NotificationPrompt } from './components/notification-prompt/notification-prompt';
import { AnalyticsService } from './services/analytics.service';
import { SyncService } from './services/sync.service';
import { AppStateService } from './services/app-state.service';
import { UpdateService } from './services/update.service';
import { SafariWarningDialog } from './safari-warning-dialog/safari-warning-dialog';
import { isIosDevice } from './utils/browser.util';

// Material components (MDC-based tab nav bar)
import { MatTabNav, MatTabLink, MatTabNavPanel } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';

const SAFARI_WARNING_DISMISSED_KEY = 'safariWarningDismissed';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,

    // Material modules
    MatTabNav, MatTabLink, MatTabNavPanel, MatIconModule,
    RouterLink, RouterLinkActive, RouterOutlet,
    TranslateModule,

    // My components:
    AudioPlayer,
    InstallPrompt,
    NotificationPrompt
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  currentLanguageName: string = "Português";
  languageMap = {
    "pt": "Português",
    "en": "English",
    "es": "Español",
    "zh": "中文 (Chinese)",
    "ja": "日本語"
  };

  protected readonly title = signal('bible-audio2');

  links: string[] = ['Home', 'Planos', 'Configs'];
  activeLink = this.links[0];

  constructor(
    private translate: TranslateService,
    private analytics: AnalyticsService,
    private sync: SyncService,
    public appState: AppStateService,
    private updateServ: UpdateService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {
    let lang = localStorage.getItem("selectedBible");
    if(lang) {
      //@ts-ignore
      this.currentLanguageName = this.languageMap[lang.split("-")[0]];
    }

    this.updateServ.updateReady$.subscribe(ready => {
      if (!ready) return;
      const message = this.translate.instant('update_available.message');
      const action = this.translate.instant('update_available.reload');
      this.snackBar.open(message, action, { duration: undefined })
        .onAction().subscribe(() => this.updateServ.reload());
    });

    this.maybeShowSafariWarning();
  }

  // On iOS, every browser (Safari, Chrome, Firefox) runs on the same WebKit
  // engine under the hood, so none of them can do background audio playback
  // or push notifications with the tab/app in the background — only an
  // installed (Home Screen) PWA can. Desktop Safari's notification/playback
  // gaps are a lower priority, so this only targets phones/tablets.
  private maybeShowSafariWarning(): void {
    if (localStorage.getItem(SAFARI_WARNING_DISMISSED_KEY) === 'true') return;
    if (!isIosDevice()) return;
    if (this.isRunningStandalone()) return;

    const dialogRef = this.dialog.open(SafariWarningDialog, {
      width: '420px',
      maxWidth: '90vw',
      autoFocus: false
    });
    dialogRef.afterClosed().subscribe(() => {
      localStorage.setItem(SAFARI_WARNING_DISMISSED_KEY, 'true');
    });
  }

  private isRunningStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  }
}
