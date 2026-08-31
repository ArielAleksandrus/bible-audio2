import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { filter, take } from 'rxjs/operators';

import { InstallPromptService } from '../../services/install-prompt.service';
import { NotificationsService } from '../../services/notifications.service';

const DISMISSED_KEY = 'notificationPromptDismissed';

// "Enable daily reminders" banner, shown once per first-time visit — but
// only after the install-prompt banner has been resolved (dismissed,
// accepted, or determined not applicable), so a new user isn't shown two
// stacked banners at once.
@Component({
  selector: 'app-notification-prompt',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './notification-prompt.html',
  styleUrl: './notification-prompt.scss'
})
export class NotificationPrompt {
  visible = false;
  busy = false;

  constructor(
    private installServ: InstallPromptService,
    public notifServ: NotificationsService,
    private cdr: ChangeDetectorRef
  ) {
    if (!this.notifServ.enabled || !this.notifServ.supported) return;
    if (this.notifServ.isSubscribed) return;
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    // Already explicitly blocked at the browser level — re-prompting would
    // just fail silently, and the browser won't show its permission UI again.
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return;

    this.installServ.resolved$.pipe(filter(r => r), take(1)).subscribe(() => {
      this.visible = true;
      this.cdr.detectChanges();
    });
  }

  async enable(): Promise<void> {
    this.busy = true;
    try {
      const selectedBible = localStorage.getItem('selectedBible') || '';
      const lang = selectedBible.split('-')[0] || 'en';
      await this.notifServ.subscribe(lang);
    } catch (err) {
      console.warn('NotificationPrompt: subscribe failed', err);
    } finally {
      this.busy = false;
      this.visible = false;
    }
  }

  dismiss(): void {
    this.visible = false;
    localStorage.setItem(DISMISSED_KEY, 'true');
  }
}
