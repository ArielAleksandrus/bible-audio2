import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';

import { currentCatalog, parseCatalog, setCatalog, withSelectedKept } from '../data/bible-catalog';
import { tracksForStoredIds } from '../data/stored-chapters';
import { audioStorage } from '../storage/audio-storage';
import { onWifi, watchWifi } from '../utils/network.util';
import { isNativeApp } from '../utils/platform.util';
import { AudioDownloaderService } from './audio-downloader.service';
import { BIBLE_CDN_URL } from './bible.service';

export const CATALOG_URL = `${BIBLE_CDN_URL}/catalog.json`;

/** A return to the app sooner than this after the last check does not check again. */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keeps the list of Bibles (versions and narrators) up to date from the CDN,
 * so new ones show up with no app update of any kind. Whenever the app opens
 * or comes back with a connection it reads catalog.json; a valid list that
 * differs from the one in use replaces it and is kept on the device
 * (bible-catalog.ts). Offline, file missing or malformed: the app goes on
 * with the list it has.
 *
 * After a catalog is in hand, chapters already on the device whose audio
 * revision moved are downloaded on Wi-Fi, without waiting for play
 * (AudioDownloaderService.prefetchStaleOnWifi). A connection that is
 * cellular, or that the browser cannot identify, waits for the next play.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  /** Emits after the list in use changes, so open pages can re-read versions and narrators. */
  readonly changed$ = new Subject<void>();

  private readonly downloader = inject(AudioDownloaderService);
  private checking = false;
  private lastCheck = 0;

  listen(): void {
    void this.refresh();
    void this.prefetchUpdates();
    window.addEventListener('online', () => void this.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastCheck >= MIN_INTERVAL_MS) void this.refresh();
    });
    watchWifi(() => void this.prefetchUpdates());
  }

  /** Resolves true when the list in use changed. */
  async refresh(): Promise<boolean> {
    if (this.checking) return false;
    this.checking = true;
    try {
      const remote = parseCatalog(await this.fetchCatalog());
      this.lastCheck = Date.now();
      if (!remote) return false;
      const previous = currentCatalog();
      const next = withSelectedKept(remote, previous, localStorage.getItem('selectedBible'));
      const changed = JSON.stringify(next) !== JSON.stringify(previous);
      if (changed) {
        setCatalog(next);
        this.changed$.next();
      }
      // The list may already have been the current one: stored chapters can
      // still be older than it, and this is the moment the device is online.
      void this.prefetchUpdates();
      return changed;
    } catch {
      // Offline or the CDN is unreachable: try again on the next occasion.
      return false;
    } finally {
      this.checking = false;
    }
  }

  /** Chapters already stored, at a revision the catalog has since raised. No-op off Wi-Fi. */
  private async prefetchUpdates(): Promise<void> {
    if (!(await onWifi())) return;
    try {
      const files = await audioStorage.list();
      this.downloader.prefetchStaleOnWifi(tracksForStoredIds(files.map(file => file.id)));
    } catch (err) {
      console.warn('Could not look for updated chapters', err);
    }
  }

  private async fetchCatalog(): Promise<unknown> {
    if (isNativeApp()) {
      // Native HTTP, like the Bible text (BibleService.fetchJsonWithProgress).
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({ url: CATALOG_URL, responseType: 'json' });
      if (res.status < 200 || res.status >= 300) return null;
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    }
    const res = await fetch(CATALOG_URL, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  }
}
