import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { Bible } from 'bible-picker';

import { VoiceDownloadService } from './voice-download.service';
import { BibleService } from './bible.service';
import { PreferencesService } from './preferences.service';
import { UiService } from './ui.service';
import { AudioDownloaderService } from './audio-downloader.service';
import { appTestProviders } from '../../testing/test-providers';
import { BibleCatalogEntry, resetCatalog, setCatalog } from '../data/bible-catalog';
import { NarratorChoiceDialog } from '../narrator-choice-dialog/narrator-choice-dialog';
import { AvailableSpace } from '../storage/my-db';

describe('VoiceDownloadService', () => {
  const twoVoices: BibleCatalogEntry = {
    lang: 'pt', version: 'otb', flag: '', label: 'OTB',
    narrators: [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana', books: ['GEN'] }],
  };
  const bible = {
    version: 'otb', language: 'pt-br',
    books: [
      { abbrev: 'Gn', name: 'Gênesis', chapters: [['a'], ['b']] },
      { abbrev: 'Ex', name: 'Êxodo', chapters: [['c']] },
    ],
  } as unknown as Bible;

  function setup(pick: string[] | undefined, downloaded: string[] = []) {
    const bibleServ = TestBed.inject(BibleService);
    const prefs = TestBed.inject(PreferencesService);
    vi.spyOn(TestBed.inject(AudioDownloaderService), 'isDownloaded').mockResolvedValue(false);
    vi.spyOn(bibleServ, 'narratorsDownloaded').mockResolvedValue(downloaded);
    vi.spyOn(bibleServ, 'localSamples').mockResolvedValue({});
    vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(10_000);
    const downloadEntireBible = vi.spyOn(bibleServ, 'downloadEntireBible').mockResolvedValue([]);
    const setNarrator = vi.spyOn(prefs, 'setNarrator');
    const create = vi.spyOn(TestBed.inject(ModalController), 'create').mockResolvedValue({
      present: async () => undefined,
      onDidDismiss: async () => ({ data: pick, role: pick ? 'selected' : 'cancel' }),
    } as any);
    return { service: TestBed.inject(VoiceDownloadService), downloadEntireBible, setNarrator, create };
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: appTestProviders() });
    setCatalog([twoVoices]);
  });
  afterEach(() => { resetCatalog(); vi.restoreAllMocks(); });

  it('asks which voices, with the size of each, the voice in use ticked', async () => {
    const { service, create } = setup(['ariel']);
    await service.chooseAndDownload(bible);
    const opts = create.mock.calls[0][0] as any;
    expect(opts.component).toBe(NarratorChoiceDialog);
    expect(opts.componentProps.choices).toEqual(twoVoices.narrators);
    expect(opts.componentProps.preselected).toEqual(['ariel']);
    // Ana has only Genesis (2 chapters), Ariel every book (3).
    expect(opts.componentProps.sizes.ana).toBeLessThan(opts.componentProps.sizes.ariel);
    expect(opts.componentProps.freeBytes).toBe(10_000 * 1024 * 1024);
  });

  it('downloads every voice ticked, in one batch', async () => {
    const { service, downloadEntireBible } = setup(['ariel', 'ana']);
    await service.chooseAndDownload(bible);
    expect(downloadEntireBible).toHaveBeenCalledWith(bible, expect.any(Object), ['ariel', 'ana']);
  });

  it('makes a ticked voice the one in use when the voice in use is not on the device and not ticked', async () => {
    const { service, setNarrator } = setup(['ana']);
    await service.chooseAndDownload(bible);
    expect(setNarrator).toHaveBeenCalledWith(twoVoices, 'ana');
  });

  it('keeps the voice in use when it is already on the device', async () => {
    const { service, setNarrator } = setup(['ana'], ['ariel']);
    await service.chooseAndDownload(bible);
    expect(setNarrator).not.toHaveBeenCalled();
  });

  it('downloads nothing when the dialog is closed', async () => {
    const { service, downloadEntireBible, setNarrator } = setup(undefined);
    expect(await service.chooseAndDownload(bible)).toEqual([]);
    expect(downloadEntireBible).not.toHaveBeenCalled();
    expect(setNarrator).not.toHaveBeenCalled();
  });

  it('does not ask which voice for a version with one, but asks before filling the device', async () => {
    setCatalog([{ ...twoVoices, narrators: [twoVoices.narrators![0]] }]);
    const { service, create, downloadEntireBible } = setup(undefined);
    vi.spyOn(AvailableSpace.prototype, 'inMB').mockResolvedValue(1);
    const confirm = vi.spyOn(TestBed.inject(UiService), 'confirm').mockResolvedValue(false);
    expect(await service.chooseAndDownload(bible)).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
    expect(downloadEntireBible).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    await service.chooseAndDownload(bible);
    expect(downloadEntireBible).toHaveBeenCalledWith(bible, expect.any(Object), [undefined]);
  });
});
