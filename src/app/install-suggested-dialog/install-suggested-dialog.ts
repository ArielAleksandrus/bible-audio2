import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

import { InstallPromptService } from '../services/install-prompt.service';
import { SafariWarningDialog } from '../safari-warning-dialog/safari-warning-dialog';
import { isIosDevice } from '../utils/browser.util';

// Shown (alongside, not instead of, the real full-Bible download — see
// Home.fullDownload()) when a mobile user in a real browser hasn't installed
// the app yet. Purely a suggestion: the download already started regardless
// of what the user does here, so both buttons just close the dialog, and
// "Instalar" additionally points them at the platform-appropriate install
// flow (iOS: SafariWarningDialog's tutorial; Android: the native
// beforeinstallprompt flow via the existing install banner).
@Component({
  selector: 'app-install-suggested-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './install-suggested-dialog.html',
  styleUrl: './install-suggested-dialog.scss'
})
export class InstallSuggestedDialog {
  constructor(
    public dialogRef: MatDialogRef<InstallSuggestedDialog>,
    private dialog: MatDialog,
    private installServ: InstallPromptService
  ) {}

  dismiss(): void {
    this.dialogRef.close();
  }

  install(): void {
    this.dialogRef.close();
    if (isIosDevice()) {
      this.dialog.open(SafariWarningDialog, { width: '420px', maxWidth: '90vw', autoFocus: false });
    } else {
      this.installServ.forceShow('android');
    }
  }
}
