import { Component, inject } from '@angular/core';
import { IonItem, IonLabel, IonList, IonSpinner, ModalController } from '@ionic/angular';

/** First-run (and "reset language") picker. Dismisses with e.g. `'pt-ara'`. */
@Component({
  selector: 'app-language-selector-dialog',
  templateUrl: './language-selector-dialog.html',
  styleUrl: './language-selector-dialog.scss',
  imports: [IonList, IonItem, IonLabel, IonSpinner],
})
export class LanguageSelectorDialog {
  private modalCtrl = inject(ModalController);

  loading = false;

  readonly options = [
    { lang: 'pt', version: 'ara', flag: '🇧🇷', label: 'Português - ARA' },
    { lang: 'en', version: 'niv', flag: '🇺🇸', label: 'English - NIV' },
    { lang: 'es', version: 'nvi', flag: '🇪🇸', label: 'Español - NVI' },
    { lang: 'zh', version: 'cnvs', flag: '🇨🇳', label: 'Chinese - CNVS (简体)' },
    { lang: 'ja', version: 'jcb', flag: '🇯🇵', label: '日本語 - JCB' },
  ];

  select(language: string, version: string) {
    this.loading = true;
    void this.modalCtrl.dismiss(`${language}-${version}`, 'selected');
  }
}
