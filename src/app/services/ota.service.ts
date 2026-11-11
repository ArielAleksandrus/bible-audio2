import { Injectable, InjectionToken, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { environment } from '../../environments/environment';
import { isNativeApp, nativePlatform } from '../utils/platform.util';
import { UiService } from './ui.service';

/**
 * The level of the native shell this web bundle depends on. A store app only
 * takes, over the air, a bundle of its own level; an older shell stays on the
 * version it has until it is updated from the store. So the level goes up only
 * when the web code starts needing something new from the native side: a new
 * or upgraded plugin, a new permission, a higher minimum OS version. A change
 * inside the native projects that the web code does not call does not raise
 * it. Raising it means a new store build, which is what a major version is.
 *
 * 1 is the first shell that can update over the air (v2.0.0).
 *
 * scripts/ota-bundle.mjs reads this number for the manifest.
 */
export const NATIVE_LEVEL = 1;

export type StorePlatform = 'android' | 'ios';

/**
 * ota/manifest.json, written by scripts/ota-bundle.mjs and deployed with the
 * web app. `url` is relative to the manifest; `checksum` is the zip's sha256.
 * `store` is the version each store has already published (ota-store.json,
 * filled in by hand once the store release is live).
 */
export interface OtaManifest {
  version: string;
  native_level: number;
  url: string;
  checksum: string;
  store?: Partial<Record<StorePlatform, string | null>>;
}

const STORE_URLS: Record<StorePlatform, string> = {
  android: 'market://details?id=live.nlabs.biblia',
  ios: 'https://apps.apple.com/app/id6832831597',
};
const STORE_NAMES: Record<StorePlatform, string> = { android: 'Google Play', ios: 'App Store' };

/** @capgo/capacitor-updater in manual mode. A plain object so tests can swap it. */
export interface NativeUpdater {
  /** This bundle opened: without it within 10 s the plugin rolls back to the previous one. */
  ready(): Promise<void>;
  bundles(): Promise<{ id: string; version: string; status: string }[]>;
  download(url: string, version: string, checksum: string): Promise<{ id: string }>;
  /** Takes effect when the app goes to the background or is closed, never mid-use. */
  next(id: string): Promise<void>;
  onResume(fn: () => void): void;
  /** Platform and version of the installed store shell (not of the web bundle). */
  shell(): Promise<{ platform: string; version: string }>;
  openStore(url: string): void;
}

// The plugins are imported on demand so the browser build never loads them.
const updaterPlugin = () => import('@capgo/capacitor-updater').then(m => m.CapacitorUpdater);
const appPlugin = () => import('@capacitor/app').then(m => m.App);

export const NATIVE_UPDATER = new InjectionToken<NativeUpdater>('NATIVE_UPDATER', {
  providedIn: 'root',
  factory: () => ({
    ready: async () => { await (await updaterPlugin()).notifyAppReady(); },
    bundles: async () => (await (await updaterPlugin()).list()).bundles,
    download: async (url, version, checksum) => (await updaterPlugin()).download({ url, version, checksum }),
    next: async id => { await (await updaterPlugin()).next({ id }); },
    onResume: fn => { void appPlugin().then(app => app.addListener('resume', fn)); },
    shell: async () => ({ platform: nativePlatform(), version: (await (await appPlugin()).getInfo()).version }),
    // A link that is not the app's own leaves the WebView and opens in the system.
    openStore: url => { window.location.href = url; },
  }),
});

/** Whether this is the store app; tests swap it. */
export const IS_NATIVE_APP = new InjectionToken<boolean>('IS_NATIVE_APP', {
  providedIn: 'root',
  factory: () => isNativeApp(),
});

/**
 * New versions for the store apps, over the air (the web app updates through
 * its service worker, see UpdateService). On launch and whenever the app comes
 * back to the foreground it reads the manifest deployed with the web app; a
 * newer version of the same native level is downloaded silently and takes
 * effect the next time the app leaves the screen, so playback is never cut.
 * If the manifest or the download fails, the app stays on what it has. A
 * version that did not open (the plugin rolled back) is kept marked as failed
 * and is not downloaded again.
 */
@Injectable({ providedIn: 'root' })
export class OtaService {
  private readonly native = inject(IS_NATIVE_APP);
  private readonly updater = inject(NATIVE_UPDATER);
  private readonly ui = inject(UiService);
  private readonly translate = inject(TranslateService);
  private checking = false;
  /** The store notice shows once per launch, not on every return to the app. */
  private storeAsked = false;

  /** Empty turns the check off. */
  manifestUrl: string = environment.otaUrl;
  appVersion: string = environment.appVersion;

  listen(): void {
    if (!this.native) return;
    void this.updater.ready().catch(() => undefined);
    if (!this.manifestUrl) return;
    void this.check();
    this.updater.onResume(() => void this.check());
  }

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const manifest = await this.manifest();
      if (!manifest) return;
      void this.askStore(manifest).catch(() => undefined);
      if (manifest.native_level !== NATIVE_LEVEL || !newer(manifest.version, this.appVersion)) return;
      const known = (await this.updater.bundles()).find(b => b.version === manifest.version);
      if (known?.status === 'error') return;
      const ready = known && (known.status === 'pending' || known.status === 'success');
      const id = ready
        ? known.id
        : (await this.updater.download(new URL(manifest.url, this.manifestUrl).href, manifest.version, manifest.checksum)).id;
      await this.updater.next(id);
    } catch {
      // Offline, server down, checksum mismatch: try again on the next launch.
    } finally {
      this.checking = false;
    }
  }

  /**
   * A new major version in the store: a major is the one that needs a new
   * build, and the old shell gets nothing more over the air. Once per launch,
   * a dismissible notice leads to the store — only after the store has
   * actually published it (`store` in the manifest).
   */
  private async askStore(manifest: OtaManifest): Promise<void> {
    if (this.storeAsked) return;
    this.storeAsked = true;
    const shell = await this.updater.shell();
    const platform = shell.platform as StorePlatform;
    const published = manifest.store?.[platform];
    const url = STORE_URLS[platform];
    if (!published || !url || major(published) <= major(shell.version)) return;
    const message = this.translate.instant('store_update.message', { version: published, store: STORE_NAMES[platform] });
    const action = this.translate.instant('store_update.action');
    if (await this.ui.actionToast(message, action)) this.updater.openStore(url);
  }

  private async manifest(): Promise<OtaManifest | null> {
    const res = await fetch(this.manifestUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.json()) as Partial<OtaManifest>;
    const valid =
      typeof m.version === 'string' &&
      typeof m.native_level === 'number' &&
      typeof m.url === 'string' &&
      typeof m.checksum === 'string';
    return valid ? (m as OtaManifest) : null;
  }
}

/** a > b for x.y.z versions. Forward only: undoing a bad bundle is publishing the fix as the next version. */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

function major(version: string): number {
  return Number(version.split('.')[0]) || 0;
}
