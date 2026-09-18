import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subscription, filter, take } from 'rxjs';

import { AudioService } from './audio.service';
import { detectOverlayLanguage, isInstagramInAppBrowser } from '../utils/browser.util';

export interface InAppBrowserWarningTexts {
  title: string;
  message: string;
  menu_hint: string;
  dismiss: string;
}

// Drives the "you're in Instagram's browser" banner. Dismissing it isn't
// permanent — the whole point is to catch the user right as playback is
// about to be interrupted by locking the screen/switching apps, so it needs
// to be able to speak up again once that becomes relevant again: the next
// track the user deliberately picks (armForNextPlay), or a page whose whole
// purpose is starting playback (showNow, used when landing on Plans).
@Injectable({ providedIn: 'root' })
export class InAppBrowserWarningService {
  texts$ = new BehaviorSubject<InAppBrowserWarningTexts | null>(null);

  private armSub: Subscription | null = null;

  constructor(private translate: TranslateService, private audioService: AudioService) {}

  /**
   * Call right when the user manually picks a track/chapter to play. Waits
   * for that track to actually start playing before showing anything, so
   * the banner doesn't appear while it's still downloading.
   */
  armForNextPlay(): void {
    if (!isInstagramInAppBrowser()) return;
    this.armSub?.unsubscribe();
    this.armSub = this.audioService.isPlaying$
      .pipe(filter(playing => playing), take(1))
      .subscribe(() => this.show());
  }

  /** Call on landing on a page whose purpose is starting playback (Plans). */
  showNow(): void {
    if (!isInstagramInAppBrowser()) return;
    this.show();
  }

  dismiss(): void {
    this.texts$.next(null);
    this.armSub?.unsubscribe();
    this.armSub = null;
  }

  private show(): void {
    // Every current trigger (fullDownload/bpSelected on Home, Plans) fires
    // after the user has already picked a Bible language, so prefer that
    // over the browser's language — otherwise a Portuguese-speaking user
    // whose phone/browser is set to English would see this banner in
    // English despite having chosen Portuguese in the app. detectOverlayLanguage()
    // (browser-based) is only the fallback for the case this fires before
    // any language is known.
    const lang = this.translate.currentLang || detectOverlayLanguage();
    // reloadLang() fetches the translation file without touching
    // TranslateService's currentLang, so this doesn't interfere with the
    // language the rest of the app ends up using once a Bible is picked.
    this.translate.reloadLang(lang).subscribe((json: Record<string, unknown>) => {
      this.texts$.next((json['in_app_browser_warning'] as InAppBrowserWarningTexts) ?? null);
    });
  }
}
