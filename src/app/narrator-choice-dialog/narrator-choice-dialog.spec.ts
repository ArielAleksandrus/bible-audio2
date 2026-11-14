import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { NarratorChoiceDialog, SAMPLE_SECONDS } from './narrator-choice-dialog';
import { AudioService } from '../services/audio.service';

describe('NarratorChoiceDialog', () => {
  const modal = { dismiss: vi.fn().mockResolvedValue(true) };
  const player = { pause: vi.fn() };

  /** A stand-in for the <audio> element that records what was asked of it and lets a test fire its events. */
  function fakeAudio(url: string) {
    const handlers: Record<string, () => void> = {};
    return {
      url,
      currentTime: 0,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      addEventListener: (type: string, fn: () => void) => { handlers[type] = fn; },
      fire: (type: string) => handlers[type]?.(),
    };
  }

  function setup() {
    const dialog = TestBed.createComponent(NarratorChoiceDialog).componentInstance;
    dialog.lang = 'pt';
    dialog.version = 'otb';
    dialog.choices = [{ id: 'ariel', label: 'Ariel' }, { id: 'ana', label: 'Ana' }];
    const made: ReturnType<typeof fakeAudio>[] = [];
    dialog.audioFactory = url => {
      const audio = fakeAudio(url);
      made.push(audio);
      return audio as any;
    };
    return { dialog, made };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NarratorChoiceDialog],
      providers: [
        provideTranslateService(),
        { provide: ModalController, useValue: modal },
        { provide: AudioService, useValue: player },
      ],
    }).compileComponents();
  });

  const CDN = 'https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev/audios/pt/OTB';

  it('plays the narrator’s own sample and pauses the app’s player', () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ana');
    expect(made[0].url).toBe(`${CDN}/ana/sample.mp3`);
    expect(made[0].play).toHaveBeenCalled();
    expect(player.pause).toHaveBeenCalled();
    expect(dialog.playing()).toBe('ana');
  });

  it('without a sample file, falls back to Genesis 1 in that voice', () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ana');
    made[0].fire('error');
    expect(made[1].url).toBe(`${CDN}/ana/GEN/GEN 1.mp3`);
    expect(made[1].play).toHaveBeenCalled();
    expect(dialog.playing()).toBe('ana');
    expect(dialog.failed()).toBeUndefined();
  });

  it('offline, plays Genesis 1 from the device for a voice that has it', () => {
    const { dialog, made } = setup();
    dialog.localSamples = { ariel: 'blob:local-gen-1' };
    dialog.toggleSample('ariel');
    made[0].fire('error');
    expect(made[1].url).toBe('blob:local-gen-1');
    expect(dialog.playing()).toBe('ariel');
  });

  it('stops the sample at 15 seconds', () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ariel');
    made[0].currentTime = SAMPLE_SECONDS - 1;
    made[0].fire('timeupdate');
    expect(dialog.playing()).toBe('ariel');

    made[0].currentTime = SAMPLE_SECONDS;
    made[0].fire('timeupdate');
    expect(made[0].pause).toHaveBeenCalled();
    expect(dialog.playing()).toBeUndefined();
  });

  it('tapping the playing sample stops it; tapping another voice switches to it', () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ariel');
    dialog.toggleSample('ariel');
    expect(made[0].pause).toHaveBeenCalled();
    expect(dialog.playing()).toBeUndefined();
    expect(made).toHaveLength(1);

    dialog.toggleSample('ariel');
    dialog.toggleSample('ana');
    expect(made[1].pause).toHaveBeenCalled();
    expect(dialog.playing()).toBe('ana');

    // A late event from the sample that was replaced changes nothing.
    made[1].fire('ended');
    expect(dialog.playing()).toBe('ana');
  });

  it('says so only when no source can be played', async () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ana');
    made[0].fire('error');
    expect(dialog.failed()).toBeUndefined();
    made[1].fire('error');
    expect(dialog.playing()).toBeUndefined();
    expect(dialog.failed()).toBe('ana');

    dialog.audioFactory = url => ({ ...fakeAudio(url), play: vi.fn().mockRejectedValue(new Error('NotAllowed')) }) as any;
    dialog.toggleSample('ariel');
    await vi.waitFor(() => expect(dialog.failed()).toBe('ariel'));
  });

  it('ticks the voice in use, keeps the catalog order and dismisses with the voices ticked', () => {
    const { dialog, made } = setup();
    dialog.preselected = ['ana'];
    dialog.ngOnInit();
    expect(dialog.selected()).toEqual(['ana']);
    dialog.toggle('ariel');
    expect(dialog.selected()).toEqual(['ariel', 'ana']);
    dialog.toggleSample('ana');
    dialog.confirm();
    expect(made[0].pause).toHaveBeenCalled();
    expect(modal.dismiss).toHaveBeenCalledWith(['ariel', 'ana'], 'selected');
  });

  it('needs at least one voice ticked', () => {
    const { dialog } = setup();
    dialog.ngOnInit();
    dialog.confirm();
    expect(modal.dismiss).not.toHaveBeenCalled();
  });

  it('does not let a voice already on the device be ticked again', () => {
    const { dialog } = setup();
    dialog.downloaded = ['ariel'];
    dialog.preselected = ['ariel'];
    dialog.ngOnInit();
    expect(dialog.selected()).toEqual([]);
    dialog.toggle('ariel');
    expect(dialog.selected()).toEqual([]);
  });

  it('adds up the sizes and says when they do not fit', () => {
    const { dialog } = setup();
    dialog.sizes = { ariel: 1.1e9, ana: 1.0e9 };
    dialog.freeBytes = 2.0e9;
    dialog.ngOnInit();
    dialog.toggle('ariel');
    expect(dialog.totalBytes()).toBe(1.1e9);
    expect(dialog.tooBig()).toBe(false);
    dialog.toggle('ana');
    expect(dialog.totalBytes()).toBe(2.1e9);
    expect(dialog.tooBig()).toBe(true);
  });

  it('closing chooses nobody', () => {
    const { dialog } = setup();
    dialog.close();
    expect(modal.dismiss).toHaveBeenCalledWith(undefined, 'cancel');
  });
});
