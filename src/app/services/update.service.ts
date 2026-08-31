import { Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { BehaviorSubject } from 'rxjs';
import { filter } from 'rxjs/operators';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Detects and applies new deployed versions. Without this, Angular's service
// worker only swaps to a new version on a fresh load *after* every tab/client
// on the old version has fully closed — for an installed PWA (which people
// rarely fully quit) that can lag for a long time, leaving users on stale JS
// that references assets a since-deployed fix may have renamed or removed
// (exactly what broke pt.json loading once already).
@Injectable({ providedIn: 'root' })
export class UpdateService {
  // Emits true once a new version has downloaded and is ready to activate —
  // the UI can prompt the user to reload rather than doing it silently
  // mid-session (a forced reload while someone's mid-chapter is jarring).
  updateReady$ = new BehaviorSubject<boolean>(false);

  constructor(private swUpdate: SwUpdate) {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => this.updateReady$.next(true));

    // The current session is already broken (e.g. the SW can't find a
    // resource it expects) — no point prompting, just recover immediately.
    this.swUpdate.unrecoverable.subscribe(err => {
      console.warn('UpdateService: unrecoverable state, reloading', err.reason);
      document.location.reload();
    });

    // Catch updates that land while the app is idle/backgrounded, not just
    // the check Angular already does at registration time.
    setInterval(() => this.checkForUpdate(), CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkForUpdate();
    });
  }

  reload(): void {
    document.location.reload();
  }

  private checkForUpdate(): void {
    this.swUpdate.checkForUpdate().catch(err => console.warn('UpdateService: check failed', err));
  }
}
