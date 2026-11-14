import { Injectable, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Bible } from 'bible-picker';

import { catalogEntry, narratorChoices } from '../data/bible-catalog';
import { NarratorChoiceDialog } from '../narrator-choice-dialog/narrator-choice-dialog';
import { Track } from '../models/track';
import { AvailableSpace } from '../storage/my-db';
import { SPACE_MARGIN_BYTES, formatSize } from '../utils/format-size.util';
import { isNativeApp } from '../utils/platform.util';
import { BibleService } from './bible.service';
import { PreferencesService } from './preferences.service';
import { UiService } from './ui.service';

/**
 * The full-Bible download, from Home ("Download the entire Bible") and from
 * Settings ("Download another voice"): which voices (a version read by two
 * or more lets the user tick several), whether they fit, whether it's OK
 * on mobile data, then the download itself.
 */
@Injectable({ providedIn: 'root' })
export class VoiceDownloadService {
  private bibleServ = inject(BibleService);
  private prefs = inject(PreferencesService);
  private modals = inject(ModalController);
  private translate = inject(TranslateService);
  private ui = inject(UiService);

  /** Resolves with the tracks of the batch once it is over, or [] when the user backed out. */
  async chooseAndDownload(bible: Bible): Promise<Track[]> {
    const entry = catalogEntry(bible.language, bible.version);
    const choices = narratorChoices(entry);
    const freeBytes = await this.freeBytes();

    let voices: (string | undefined)[];
    let bytes: number;
    if (entry && choices.length) {
      const downloaded = await this.bibleServ.narratorsDownloaded(bible);
      const sizes: Record<string, number> = {};
      for (const n of choices) sizes[n.id] = await this.bibleServ.voiceBytesToDownload(bible, n.id);
      const inUse = this.bibleServ.narratorOf(bible);
      const preselected = inUse && !downloaded.includes(inUse) ? [inUse] : choices.filter(n => !downloaded.includes(n.id)).slice(0, 1).map(n => n.id);

      const modal = await this.modals.create({
        component: NarratorChoiceDialog,
        componentProps: {
          lang: entry.lang, version: entry.version, choices, downloaded, sizes, freeBytes, preselected,
          localSamples: await this.bibleServ.localSamples(bible),
        },
        cssClass: 'app-dialog',
      });
      await modal.present();
      const { data } = await modal.onDidDismiss<string[]>();
      if (!data?.length) return [];
      voices = data;
      bytes = data.reduce((sum, id) => sum + sizes[id], 0);

      // What plays from now on is a voice that will be on the device.
      if (!inUse || !data.includes(inUse) && !downloaded.includes(inUse)) this.prefs.setNarrator(entry, data[0]);
    } else {
      voices = [undefined];
      bytes = await this.bibleServ.voiceBytesToDownload(bible, undefined);
      if (freeBytes !== undefined && bytes + SPACE_MARGIN_BYTES > freeBytes) {
        const go = await this.ui.confirm(this.t('hero.confirm_low_space', { size: this.size(bytes), free: this.size(freeBytes) }));
        if (!go) return [];
      }
    }

    if (await this.isOnCellular() === true) {
      const go = await this.ui.confirm(this.t('hero.confirm_mobile_data', { size: this.size(bytes) }));
      if (!go) return [];
    }

    return this.bibleServ.downloadEntireBible(bible, {
      title: this.t('hero.notif_title'),
      progress: this.t('hero.notif_progress', { downloaded: '{done}', total: '{total}' }),
      complete: this.t('hero.download_complete'),
      incomplete: this.t('hero.notif_incomplete', { failed: '{failed}' }),
      cancel: this.t('common.cancel'),
    }, voices);
  }

  /**
   * Free space, when it can be told. Web: the browser's storage estimate.
   * Native: unknown for now — the WebView's estimate doesn't measure the
   * disk the chapters go to.
   */
  private async freeBytes(): Promise<number | undefined> {
    if (isNativeApp()) return undefined;
    return (await new AvailableSpace().inMB()) * 1024 * 1024;
  }

  private size(bytes: number): string {
    return formatSize(bytes, this.translate.currentLang || 'pt');
  }

  private t(key: string, params?: object): string {
    return this.translate.instant(key, params);
  }

  /**
   * true = definitely on cellular, false = definitely not, null = can't tell
   * (API unsupported, e.g. Safari/Firefox, or `type` not exposed by this
   * browser — Chrome itself only reports it on Android, not desktop). Only a
   * sure "cellular" asks, or the question would show up always there.
   */
  private async isOnCellular(): Promise<boolean | null> {
    if (isNativeApp()) {
      const { Network } = await import('@capacitor/network');
      const status = await Network.getStatus().catch(() => null);
      return status ? status.connectionType === 'cellular' : null;
    }
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!connection || typeof connection.type === 'undefined') return null;
    return connection.type === 'cellular';
  }
}
