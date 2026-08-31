import { Injectable } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

import { dbPromise } from '../storage/my-db';
import { environment } from '../../environments/environment';

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

// Sends usage events to GA4. Works offline: events are always persisted to
// IndexedDB first and only removed once actually handed off to gtag, so
// nothing recorded while the PWA is offline gets lost if the app is closed
// before the connection comes back.
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private enabled = !!environment.gaMeasurementId;
  private scriptLoaded = false;
  private flushing = false;

  constructor(private router: Router) {
    if (!this.enabled) return;

    this.initGtag();
    this.loadScript();

    window.addEventListener('online', () => this.flush());

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.trackEvent('page_view', { page_path: e.urlAfterRedirects }));

    void this.flush();
  }

  chapterCompleted(book: string, chapter: number) {
    void this.trackEvent('chapter_completed', { book, chapter });
  }

  planStarted(planId: string) {
    void this.trackEvent('plan_started', { plan_id: planId });
  }

  planCompleted(planId: string) {
    void this.trackEvent('plan_completed', { plan_id: planId });
  }

  async trackEvent(name: string, params: Record<string, unknown> = {}): Promise<void> {
    if (!this.enabled) return;
    try {
      const db = await dbPromise;
      await db.add('analytics_queue', { name, params, ts: Date.now() });
    } catch (err) {
      console.warn('AnalyticsService: failed to queue event', name, err);
    }
    if (navigator.onLine) void this.flush();
  }

  private initGtag() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer!.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', environment.gaMeasurementId);
  }

  private loadScript() {
    if (this.scriptLoaded || !navigator.onLine) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${environment.gaMeasurementId}`;
    script.onload = () => {
      this.scriptLoaded = true;
      void this.flush();
    };
    document.head.appendChild(script);
  }

  private async flush(): Promise<void> {
    if (!this.enabled || this.flushing) return;
    if (!this.scriptLoaded) {
      this.loadScript();
      return;
    }
    this.flushing = true;
    try {
      const db = await dbPromise;
      const pending = await db.getAll('analytics_queue');
      for (const item of pending) {
        window.gtag!('event', item.name, item.params);
        if (item.id !== undefined) await db.delete('analytics_queue', item.id);
      }
    } catch (err) {
      console.warn('AnalyticsService: failed to flush queue', err);
    } finally {
      this.flushing = false;
    }
  }
}
