import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { Bible } from 'bible-picker';

import { Home } from './home';
import { appTestProviders } from '../../../testing/test-providers';
import { BibleService } from '../../services/bible.service';
import { UiService } from '../../services/ui.service';
import { capacitorPlugins } from '../../utils/capacitor-plugins';
import { runOnPlatform } from '../../../testing/fake-capacitor';

describe('Home', () => {
  let bible: { downloadEntireBible: ReturnType<typeof vi.fn>; booksDownloadStatus: ReturnType<typeof vi.fn> };
  let ui: { confirm: ReturnType<typeof vi.fn>; alert: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    bible = {
      downloadEntireBible: vi.fn().mockResolvedValue([]),
      booksDownloadStatus: vi.fn().mockResolvedValue([]),
    };
    ui = { confirm: vi.fn(), alert: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        ...appTestProviders(),
        {
          provide: BibleService,
          useValue: { ...bible, downloadProgress$: new Subject(), textDownloadProgress$: new Subject() },
        },
        { provide: UiService, useValue: ui },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.restoreAllMocks());

  it('should create', () => {
    expect(TestBed.createComponent(Home).componentInstance).toBeTruthy();
  });

  describe('full-Bible download in the native app', () => {
    function home() {
      const page = TestBed.createComponent(Home).componentInstance;
      page.bibleData = { version: 'ARA', language: 'pt', books: [] } as unknown as Bible;
      return page;
    }
    function connection(connectionType: 'wifi' | 'cellular') {
      const Network = { getStatus: vi.fn().mockResolvedValue({ connected: true, connectionType }) };
      vi.spyOn(capacitorPlugins, 'network').mockResolvedValue({ Network } as never);
    }

    beforeEach(() => runOnPlatform('android'));

    it('starts right away on Wi-Fi', async () => {
      connection('wifi');
      await home().fullDownload();
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(bible.downloadEntireBible).toHaveBeenCalled();
    });

    it('asks before using ~1.3 GB of mobile data, and respects a "no"', async () => {
      connection('cellular');
      ui.confirm.mockResolvedValue(false);
      expect(await home().fullDownload()).toEqual([]);
      expect(ui.confirm).toHaveBeenCalledTimes(1);
      expect(bible.downloadEntireBible).not.toHaveBeenCalled();
    });

    it('downloads over mobile data once the user agrees', async () => {
      connection('cellular');
      ui.confirm.mockResolvedValue(true);
      await home().fullDownload();
      expect(bible.downloadEntireBible).toHaveBeenCalled();
    });

    it('does not block the download when the network status is unknown', async () => {
      const Network = { getStatus: vi.fn().mockRejectedValue(new Error('unavailable')) };
      vi.spyOn(capacitorPlugins, 'network').mockResolvedValue({ Network } as never);
      await home().fullDownload();
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(bible.downloadEntireBible).toHaveBeenCalled();
    });
  });
});
