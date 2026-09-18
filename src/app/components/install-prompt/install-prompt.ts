import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';

import { InstallPromptService } from '../../services/install-prompt.service';
import { SafariWarningDialog } from '../../safari-warning-dialog/safari-warning-dialog';

// A custom "Install app" banner instead of waiting for the user to find the
// browser's own install option. Android/Chrome/desktop: captures the native
// beforeinstallprompt event and triggers it directly. iOS Safari has no such
// event — Apple deliberately doesn't allow triggering the "Add to Home
// Screen" flow programmatically — so there we just show instructions, and
// its close button is swapped for a help button that opens the full
// step-by-step tutorial instead of just dismissing.
@Component({
  selector: 'app-install-prompt',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './install-prompt.html',
  styleUrl: './install-prompt.scss'
})
export class InstallPrompt {
  constructor(public installServ: InstallPromptService, private dialog: MatDialog) {}

  install(): void {
    void this.installServ.install();
  }

  dismiss(): void {
    this.installServ.dismiss();
  }

  showTutorial(): void {
    this.installServ.dismiss();
    this.dialog.open(SafariWarningDialog, { width: '420px', maxWidth: '90vw', autoFocus: false });
  }
}
