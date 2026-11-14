import { Component, inject } from '@angular/core';
import { BibleCatalogEntry, LanguageOption, languageOptions } from '../data/bible-catalog';
import { IonButton, IonItem, IonLabel, IonList, IonSpinner, ModalController } from '@ionic/angular';

/**
 * Texts of the version step, in the language just chosen: the app's
 * translations are not loaded yet at this point.
 */
const VERSION_STEP: Readonly<Record<string, { title: string; back: string }>> = {
  pt: { title: 'Escolha a versão da Bíblia', back: 'Voltar' },
  en: { title: 'Choose the Bible version', back: 'Back' },
  es: { title: 'Elige la versión de la Biblia', back: 'Volver' },
  zh: { title: '选择圣经版本', back: '返回' },
  ja: { title: '聖書の訳を選んでください', back: '戻る' },
};

/**
 * First-run (and "reset language") picker. The language comes first; a
 * language with two or more versions then asks which one. Dismisses with
 * e.g. `'pt-ara'`, and only once a version is chosen.
 */
@Component({
  selector: 'app-language-selector-dialog',
  templateUrl: './language-selector-dialog.html',
  styleUrl: './language-selector-dialog.scss',
  imports: [IonList, IonItem, IonLabel, IonSpinner, IonButton],
})
export class LanguageSelectorDialog {
  private modalCtrl = inject(ModalController);

  loading = false;

  /** Languages with at least one version that is not hidden. */
  readonly options = languageOptions();

  /** The language whose versions are being shown; undefined on the language step. */
  language?: LanguageOption;

  get versionStep() {
    return VERSION_STEP[this.language?.lang ?? ''] ?? VERSION_STEP['en'];
  }

  chooseLanguage(option: LanguageOption) {
    if (option.versions.length === 1) this.select(option.versions[0]);
    else this.language = option;
  }

  backToLanguages() {
    this.language = undefined;
  }

  select(entry: BibleCatalogEntry) {
    this.loading = true;
    void this.modalCtrl.dismiss(`${entry.lang}-${entry.version}`, 'selected');
  }
}
