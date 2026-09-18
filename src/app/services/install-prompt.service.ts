import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { isAppInstalled, isInstagramInAppBrowser } from '../utils/browser.util';

const DISMISSED_KEY = 'installPromptDismissed';
const NO_PROMPT_TIMEOUT_MS = 4000;

// beforeinstallprompt isn't a standard DOM type.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Drives the "Install BibleAudio" banner. Pulled out of the InstallPrompt
// component into a service so other onboarding prompts (e.g. the daily
// reminders banner) can wait for this one to be resolved — dismissed,
// accepted, or determined not applicable — before showing themselves,
// instead of stacking multiple banners on a first-time visit.
@Injectable({ providedIn: 'root' })
export class InstallPromptService {
  visible$ = new BehaviorSubject<boolean>(false);
  // True once there's nothing left to show for install: already installed,
  // previously dismissed, just resolved (installed/dismissed just now), or
  // — for browsers that never fire beforeinstallprompt (desktop Firefox/
  // Safari) — a short timeout has passed with nothing to show.
  resolved$ = new BehaviorSubject<boolean>(false);

  mode: 'android' | 'ios' = 'android';

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (isAppInstalled() || localStorage.getItem(DISMISSED_KEY) === 'true') {
      this.resolved$.next(true);
      return;
    }

    // Its "tap Share -> Add to Home Screen" instructions don't apply inside
    // Instagram's embedded browser, which has neither — the in-app-browser
    // overlay's "open in a real browser" message covers this case instead.
    if (isInstagramInAppBrowser()) {
      this.resolved$.next(true);
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      this.mode = 'ios';
      this.visible$.next(true);
      return;
    }

    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault();
      if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.mode = 'android';
      this.visible$.next(true);
    });

    setTimeout(() => {
      if (!this.visible$.value) this.resolved$.next(true);
    }, NO_PROMPT_TIMEOUT_MS);
  }

  async install(): Promise<void> {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.visible$.next(false);
    this.resolved$.next(true);
  }

  dismiss(): void {
    this.visible$.next(false);
    this.resolved$.next(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  }

  /**
   * Force the banner back on screen for a given platform, bypassing the
   * dismissed/resolved state above. Used when another flow (the "you must
   * install this app" gate on the full-Bible download) needs to point the
   * user at install instructions on demand, even if they dismissed this
   * banner earlier or it never fired (e.g. beforeinstallprompt hasn't
   * arrived yet).
   */
  forceShow(mode: 'android' | 'ios'): void {
    this.mode = mode;
    this.visible$.next(true);
  }
}
