import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BibleCatalogEntry, LanguageOption, languageOptions } from '../data/bible-catalog';
import { CatalogService } from '../services/catalog.service';
import { IonButton, IonItem, IonLabel, IonList, IonSpinner, ModalController } from '@ionic/angular';

/** How long the picker waits for catalog.json before offering the bundled list. */
const CATALOG_WAIT_MS = 5000;

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
 *
 * The list stays hidden until catalog.json has been tried, so a first open
 * does not offer only the bundled language. If that check fails or takes
 * too long, the bundled list is the fallback; a late reply still replaces it.
 */
@Component({
  selector: 'app-language-selector-dialog',
  templateUrl: './language-selector-dialog.html',
  styleUrl: './language-selector-dialog.scss',
  imports: [IonList, IonItem, IonLabel, IonSpinner, IonButton],
})
export class LanguageSelectorDialog {
  private modalCtrl = inject(ModalController);
  private catalog = inject(CatalogService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  loading = false;

  /** Spinner: the CDN list is not in yet, and the fallback is not offered yet. */
  waiting = true;

  /** Languages with at least one version that is not hidden. */
  options: LanguageOption[] = [];

  /** The language whose versions are being shown; undefined on the language step. */
  language?: LanguageOption;

  constructor() {
    this.catalog.changed$.pipe(takeUntilDestroyed()).subscribe(() => this.apply());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>(resolve => {
      timer = setTimeout(resolve, CATALOG_WAIT_MS);
    });
    this.destroyRef.onDestroy(() => clearTimeout(timer));
    void Promise.race([this.catalog.whenReady(), timeout]).then(() => {
      clearTimeout(timer);
      if (this.destroyRef.destroyed) return;
      this.waiting = false;
      this.apply();
    });
  }

  get versionStep() {
    return VERSION_STEP[this.language?.lang ?? ''] ?? VERSION_STEP['en'];
  }

  /** Re-read the catalog. A language that disappeared returns to the first step. */
  private apply() {
    this.options = languageOptions();
    if (this.language) this.language = this.options.find(o => o.lang === this.language!.lang);
    this.cdr.markForCheck();
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
