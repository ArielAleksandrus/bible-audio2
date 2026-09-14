import { Injectable } from '@angular/core';

// Thin wrapper around the Screen Wake Lock API. This only stops the screen
// from turning itself off due to inactivity while the tab stays visible —
// per spec, the browser releases the lock the instant the document goes
// hidden, so it can't (and isn't meant to) keep a manual power-button lock
// or a backgrounded tab from happening. It re-acquires automatically when
// the tab becomes visible again while still wanted, in case something long
// running (e.g. a bulk download) is still in progress.
@Injectable({ providedIn: 'root' })
export class WakeLockService {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') {
        void this.acquire();
      }
    });
  }

  async request(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  release(): void {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => {});
  }

  private async acquire(): Promise<void> {
    if (this.sentinel || !this.wanted) return;
    if (!('wakeLock' in navigator)) return;

    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        void sentinel.release().catch(() => {});
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Can fail for plenty of reasons (page not visible yet, permissions
      // policy, battery saver, unsupported browser) — the download just
      // proceeds without the extra protection against screen auto-lock.
    }
  }
}
