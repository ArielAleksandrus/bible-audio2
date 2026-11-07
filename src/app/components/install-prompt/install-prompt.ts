import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { IonButton, IonIcon, ModalController } from '@ionic/angular';

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
  imports: [CommonModule, TranslatePipe, IonButton, IonIcon],
  templateUrl: './install-prompt.html',
  styleUrl: './install-prompt.scss'
})
export class InstallPrompt {
  installServ = inject(InstallPromptService);
  private modals = inject(ModalController);

  install(): void {
    void this.installServ.install();
  }

  dismiss(): void {
    this.installServ.dismiss();
  }

  async showTutorial(): Promise<void> {
    this.installServ.dismiss();
    const modal = await this.modals.create({ component: SafariWarningDialog, cssClass: 'app-dialog-tall' });
    await modal.present();
  }
}
