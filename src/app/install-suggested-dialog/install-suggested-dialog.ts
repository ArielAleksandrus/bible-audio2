import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IonButton, IonIcon, ModalController } from '@ionic/angular';

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
  imports: [TranslatePipe, IonButton, IonIcon],
  templateUrl: './install-suggested-dialog.html',
  styleUrl: './install-suggested-dialog.scss'
})
export class InstallSuggestedDialog {
  private modals = inject(ModalController);
  private installServ = inject(InstallPromptService);

  dismiss(): void {
    void this.modals.dismiss();
  }

  async install(): Promise<void> {
    await this.modals.dismiss();
    if (isIosDevice()) {
      const modal = await this.modals.create({ component: SafariWarningDialog, cssClass: 'app-dialog-tall' });
      await modal.present();
    } else {
      this.installServ.forceShow('android');
    }
  }
}
