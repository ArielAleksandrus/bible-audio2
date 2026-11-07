import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

/**
 * Ionic replacements for window.alert / window.confirm / MatSnackBar.
 * Native-looking on both platforms and, unlike window.alert, never blocks
 * the JS thread (which the native player's status events also run on).
 */
@Injectable({ providedIn: 'root' })
export class UiService {
  private alerts = inject(AlertController);
  private toasts = inject(ToastController);
  private translate = inject(TranslateService);

  async alert(message: string, header?: string): Promise<void> {
    const alert = await this.alerts.create({
      header,
      message,
      buttons: ['OK'],
    });
    await alert.present();
    await alert.onDidDismiss();
  }

  async confirm(message: string, header?: string): Promise<boolean> {
    const alert = await this.alerts.create({
      header,
      message,
      buttons: [
        { text: this.t('common.cancel', 'Cancelar'), role: 'cancel' },
        { text: 'OK', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  /** A toast with one action button; resolves true if the action was tapped. */
  async actionToast(message: string, action: string): Promise<boolean> {
    const toast = await this.toasts.create({
      message,
      position: 'top',
      buttons: [{ text: action, role: 'action' }, { icon: 'close', role: 'cancel' }],
    });
    await toast.present();
    const { role } = await toast.onDidDismiss();
    return role === 'action';
  }

  private t(key: string, fallback: string): string {
    const value = this.translate.instant(key);
    return value && value !== key ? value : fallback;
  }
}
