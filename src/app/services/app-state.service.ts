import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

// Tracks whether the user has picked a Bible language yet. Chrome for the
// app shell (bottom nav, install prompt) shouldn't show until then — before
// that, no i18n translations are loaded, so any translate-pipe text in that
// chrome would render as raw "menu.home"-style keys instead of real words.
//
// A language having been *picked* (localStorage has it, or markLanguageSelected
// just ran) isn't enough on its own: the page that owns the bible-loading flow
// (home.ts) only calls translate.use() once its async bible fetch resolves, so
// for a returning user the nav would otherwise render for a beat before any
// translations exist. Gate on TranslateService actually having loaded a
// language too, so the nav only appears once the words are ready to show.
@Injectable({ providedIn: 'root' })
export class AppStateService {
  private translate = inject(TranslateService);

  private languageSelected$ = new BehaviorSubject<boolean>(!!localStorage.getItem('selectedBible'));
  private translationsLoaded$ = new BehaviorSubject<boolean>(!!this.translate.currentLang);

  hasSelectedLanguage$ = combineLatest([this.languageSelected$, this.translationsLoaded$]).pipe(
    map(([selected, loaded]) => selected && loaded)
  );

  constructor() {
    this.translate.onLangChange.subscribe(() => this.translationsLoaded$.next(true));
  }

  markLanguageSelected(): void {
    this.languageSelected$.next(true);
  }
}
