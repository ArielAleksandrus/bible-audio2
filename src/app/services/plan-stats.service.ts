import { Injectable } from '@angular/core';

import { environment } from '../../environments/environment';
import { isNativeApp } from '../utils/platform.util';

export interface PlanStats {
  starts: number;
  completions: number;
  listens: number;
}
export type PlanStatEvent = 'start' | 'complete' | 'listen';

const ENDPOINT = `${isNativeApp() ? environment.apiOrigin : ''}/api/plan-stats`;
const startedKey = (planId: string) => `planStats:start:${planId}`;

/**
 * Global, anonymous counters per reading plan (see api/plan-stats.ts) — how
 * the plan list can be ordered by "most listened" for everyone, signed in or
 * not. Not to be confused with the user's own "completed Nx" count, which
 * lives in IndexedDB / users/{uid}/planCompletions.
 *
 * Everything here is best effort: a counter that fails to send is dropped,
 * and a failed read just means "most listened" has nothing to sort by.
 */
@Injectable({ providedIn: 'root' })
export class PlanStatsService {
  /** null when the stats can't be fetched (offline, no backend). */
  async fetchAll(): Promise<Record<string, PlanStats> | null> {
    try {
      const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const body = await res.json();
      return body && typeof body.stats === 'object' && body.stats ? body.stats : null;
    } catch {
      return null;
    }
  }

  /**
   * A plan went to "started". Counted once per device and plan — the marker
   * in localStorage is what keeps a reload, or deleting and restarting the
   * plan, from counting again.
   */
  countStart(planId: string): void {
    try {
      if (localStorage.getItem(startedKey(planId))) return;
      localStorage.setItem(startedKey(planId), '1');
    } catch {
      return; // can't remember it was counted: better not to count at all
    }
    this.send(planId, 'start');
  }

  /** A plan was really finished (called next to the personal completion count). */
  countComplete(planId: string): void {
    this.send(planId, 'complete');
  }

  /** Playback of a plan actually began after the user asked for it. */
  countListen(planId: string): void {
    this.send(planId, 'listen');
  }

  private send(planId: string, event: PlanStatEvent): void {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, event }),
      keepalive: true, // still goes out if the page is closed right after
    }).catch(() => {});
  }
}
