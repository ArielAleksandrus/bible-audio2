import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

// Tracks whether the user has picked a Bible language yet. Chrome for the
// app shell (bottom nav, install prompt) shouldn't show until then — before
// that, no i18n translations are loaded, so any translate-pipe text in that
// chrome would render as raw "menu.home"-style keys instead of real words.
@Injectable({ providedIn: 'root' })
export class AppStateService {
  hasSelectedLanguage$ = new BehaviorSubject<boolean>(!!localStorage.getItem('selectedBible'));

  markLanguageSelected(): void {
    this.hasSelectedLanguage$.next(true);
  }
}
