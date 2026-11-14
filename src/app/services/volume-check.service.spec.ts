import { TestBed } from '@angular/core/testing';

import { VolumeCheckService } from './volume-check.service';
import { UiService } from './ui.service';
import { appTestProviders } from '../../testing/test-providers';

describe('VolumeCheckService', () => {
  function setup(volume: number | Error, native = true) {
    TestBed.configureTestingModule({ providers: appTestProviders() });
    const service = TestBed.inject(VolumeCheckService);
    service.native = native;
    service.readVolume = () => volume instanceof Error ? Promise.reject(volume) : Promise.resolve(volume);
    const toast = vi.spyOn(TestBed.inject(UiService), 'toast').mockResolvedValue(undefined);
    return { service, toast };
  }

  it('says so when the volume is almost at zero', async () => {
    const { service, toast } = setup(0.05);
    await service.warnIfLow();
    expect(toast).toHaveBeenCalledWith('player.volume_low');
  });

  it('says nothing at a volume that can be heard', async () => {
    const { service, toast } = setup(0.3);
    await service.warnIfLow();
    expect(toast).not.toHaveBeenCalled();
  });

  it('says nothing in a browser, or in a store app without the plugin', async () => {
    const web = setup(0, false);
    await web.service.warnIfLow();
    expect(web.toast).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const old = setup(new Error('not implemented'));
    await old.service.warnIfLow();
    expect(old.toast).not.toHaveBeenCalled();
  });
});
