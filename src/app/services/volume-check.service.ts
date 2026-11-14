import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { DeviceVolume } from '../native/device-volume';
import { isNativeApp } from '../utils/platform.util';
import { UiService } from './ui.service';

/** At or below this (of the maximum), the chapter would hardly be heard. */
export const LOW_VOLUME = 0.1;

/**
 * When the user taps play (a chapter or a narrator's sample) with the media
 * volume almost at zero, says so: otherwise the app just looks broken. Only
 * in the store apps — a browser can't read the device's volume — and only
 * from the build that has the plugin; anything else stays silent.
 */
@Injectable({ providedIn: 'root' })
export class VolumeCheckService {
  private ui = inject(UiService);
  private translate = inject(TranslateService);
  /** Read the volume this way (tests swap it). */
  readVolume: () => Promise<number> = async () => (await DeviceVolume.getVolume()).volume;
  native = isNativeApp();

  async warnIfLow(): Promise<void> {
    if (!this.native) return;
    let volume: number;
    try {
      volume = await this.readVolume();
    } catch {
      return; // a shell without the plugin
    }
    if (volume <= LOW_VOLUME) await this.ui.toast(this.translate.instant('player.volume_low'));
  }
}
