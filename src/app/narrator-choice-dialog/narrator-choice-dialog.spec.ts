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

  it('plays Genesis 1 in the narrator’s own folder and pauses the app’s player', () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ana');
    expect(made[0].url).toBe('https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev/audios/pt/OTB/ana/GEN/GEN 1.mp3');
    expect(made[0].play).toHaveBeenCalled();
    expect(player.pause).toHaveBeenCalled();
    expect(dialog.playing()).toBe('ana');
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

  it('says so when the sample cannot be played', async () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ana');
    made[0].fire('error');
    expect(dialog.playing()).toBeUndefined();
    expect(dialog.failed()).toBe('ana');

    dialog.audioFactory = url => ({ ...fakeAudio(url), play: vi.fn().mockRejectedValue(new Error('NotAllowed')) }) as any;
    dialog.toggleSample('ariel');
    await Promise.resolve();
    await Promise.resolve();
    expect(dialog.failed()).toBe('ariel');
  });

  it('dismisses with the chosen narrator and stops the sample', () => {
    const { dialog, made } = setup();
    dialog.toggleSample('ana');
    dialog.choose('ana');
    expect(made[0].pause).toHaveBeenCalled();
    expect(modal.dismiss).toHaveBeenCalledWith('ana', 'selected');
  });

  it('closing chooses nobody', () => {
    const { dialog } = setup();
    dialog.close();
    expect(modal.dismiss).toHaveBeenCalledWith(undefined, 'cancel');
  });
});
