import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

import { InstallPromptService } from '../services/install-prompt.service';
import { SafariWarningDialog } from '../safari-warning-dialog/safari-warning-dialog';
import { isIosDevice } from '../utils/browser.util';

// Gate shown when a mobile user (Android or iOS, in a real browser — the
// Instagram in-app-browser case is handled separately by
// InAppBrowserWarningService) tries to download the whole Bible without
// having installed the app. Only "Continuar" moves them forward, at which
// point we point them at the platform-appropriate install flow: on iOS
// that's SafariWarningDialog's step-by-step "Share -> Add to Home Screen"
// tutorial (there's no programmatic install prompt to trigger); on Android
// it's the native beforeinstallprompt flow via the existing install banner.
@Component({
  selector: 'app-install-required-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './install-required-dialog.html',
  styleUrl: './install-required-dialog.scss'
})
export class InstallRequiredDialog {
  constructor(
    public dialogRef: MatDialogRef<InstallRequiredDialog>,
    private dialog: MatDialog,
    private installServ: InstallPromptService
  ) {}

  continue(): void {
    this.dialogRef.close();
    if (isIosDevice()) {
      this.dialog.open(SafariWarningDialog, { width: '420px', maxWidth: '90vw', autoFocus: false });
    } else {
      this.installServ.forceShow('android');
    }
  }
}
