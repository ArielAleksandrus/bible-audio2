import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

import { AudioPlayer } from './components/audio-player/audio-player';
import { InstallPrompt } from './components/install-prompt/install-prompt';
import { AnalyticsService } from './services/analytics.service';
import { SyncService } from './services/sync.service';
import { AppStateService } from './services/app-state.service';
import { UpdateService } from './services/update.service';

// Material components (MDC-based tab nav bar)
import { MatTabNav, MatTabLink, MatTabNavPanel } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

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
    InstallPrompt
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
    private snackBar: MatSnackBar
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
  }
}
