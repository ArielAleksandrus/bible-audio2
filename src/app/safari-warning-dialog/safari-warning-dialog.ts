import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IonButton, IonIcon, ModalController } from '@ionic/angular';

import { VideoExampleDialog } from '../video-example-dialog/video-example-dialog';

/** Web only (iOS Safari): explains Share → Add to Home Screen. */
@Component({
  selector: 'app-safari-warning-dialog',
  imports: [TranslatePipe, IonButton, IonIcon],
  templateUrl: './safari-warning-dialog.html',
  styleUrl: './safari-warning-dialog.scss'
})
export class SafariWarningDialog {
  private modals = inject(ModalController);

  close(): void {
    void this.modals.dismiss();
  }

  async showExample(): Promise<void> {
    const modal = await this.modals.create({ component: VideoExampleDialog, cssClass: 'app-dialog' });
    await modal.present();
  }
}
