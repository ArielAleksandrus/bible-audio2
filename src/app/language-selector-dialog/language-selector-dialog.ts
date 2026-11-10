import { Component, inject } from '@angular/core';
import { languageOptions } from '../data/bible-catalog';
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

  /** Each language's default version. Other versions of a language are a switch away, in Home and Settings. */
  readonly options = languageOptions();

  select(language: string, version: string) {
    this.loading = true;
    void this.modalCtrl.dismiss(`${language}-${version}`, 'selected');
  }
}
