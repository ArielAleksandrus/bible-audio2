import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

import { BibleCatalogEntry, baseLang, narratorChoices } from '../data/bible-catalog';

export const PLAYBACK_RATES = [1, 1.25, 1.5] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export type PlanSort = 'days' | 'alpha' | 'listens';
const PLAN_SORTS: readonly PlanSort[] = ['days', 'alpha', 'listens'];

const KEY_RATE = 'playbackRate';
const KEY_AUTOPLAY = 'autoplayOnSelect';
const KEY_PLAN_SORT = 'planSort';
const narratorKey = (lang: string, version: string) => `narrator:${baseLang(lang)}-${version.toLowerCase()}`;

/**
 * The user's listening preferences, kept in localStorage (per device, no
 * account needed — same as the selected Bible).
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly playbackRate$ = new BehaviorSubject<PlaybackRate>(this.readRate());
  /** "Play when a plan or chapter is selected". On unless the user turned it off. */
  readonly autoplay$ = new BehaviorSubject<boolean>(this.read(KEY_AUTOPLAY) !== 'false');
  /** Emits after the narrator of any version changes. */
  readonly narratorChanged$ = new Subject<void>();

  get playbackRate(): PlaybackRate { return this.playbackRate$.value; }
  get autoplay(): boolean { return this.autoplay$.value; }

  setPlaybackRate(rate: PlaybackRate): void {
    if (!PLAYBACK_RATES.includes(rate)) return;
    this.write(KEY_RATE, String(rate));
    this.playbackRate$.next(rate);
  }

  setAutoplay(on: boolean): void {
    this.write(KEY_AUTOPLAY, String(on));
    this.autoplay$.next(on);
  }

  /**
   * The narrator to use for a version: undefined unless the version offers a
   * choice (two or more), otherwise the saved one, or the first by default.
   */
  narratorFor(entry: BibleCatalogEntry | undefined): string | undefined {
    const choices = narratorChoices(entry);
    if (!entry || choices.length === 0) return undefined;
    const saved = this.read(narratorKey(entry.lang, entry.version));
    return choices.some(n => n.id === saved) ? saved! : choices[0].id;
  }

  setNarrator(entry: BibleCatalogEntry, narratorId: string): void {
    if (!narratorChoices(entry).some(n => n.id === narratorId)) return;
    this.write(narratorKey(entry.lang, entry.version), narratorId);
    this.narratorChanged$.next();
  }

  /** null = no preference saved: lists keep their own default order. */
  get planSort(): PlanSort | null {
    const saved = this.read(KEY_PLAN_SORT) as PlanSort | null;
    return saved && PLAN_SORTS.includes(saved) ? saved : null;
  }

  setPlanSort(sort: PlanSort | null): void {
    if (sort) this.write(KEY_PLAN_SORT, sort);
    else this.remove(KEY_PLAN_SORT);
  }

  private readRate(): PlaybackRate {
    const saved = Number(this.read(KEY_RATE));
    return (PLAYBACK_RATES as readonly number[]).includes(saved) ? (saved as PlaybackRate) : 1;
  }

  // Storage can throw (Safari private mode, quota): a preference that can't
  // be saved just lasts for this session.
  private read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* session-only */ }
  }
  private remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* session-only */ }
  }
}
