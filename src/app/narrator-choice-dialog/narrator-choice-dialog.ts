import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
import { IonButton, IonIcon, ModalController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { BibleNarrator } from '../data/bible-catalog';
import { AudioService } from '../services/audio.service';
import { audioUrl } from '../services/bible.service';

/** How much of the sample chapter is played. */
export const SAMPLE_SECONDS = 15;

/** The chapter every voice is sampled with: Genesis 1, the first one any narration has. */
const SAMPLE_BOOK_IDX = 0;
const SAMPLE_CHAPTER = 1;

/** The part of HTMLAudioElement the sample uses; tests swap the factory. */
export type SampleAudio = Pick<HTMLAudioElement, 'play' | 'pause' | 'addEventListener' | 'currentTime'>;

/**
 * "Which narrator?" before a full-Bible download of a version read by two or
 * more voices. Each voice can be heard first: the play button streams the
 * opening seconds of Genesis 1 in that voice, straight from the CDN, so no
 * sample files exist anywhere. Dismisses with the chosen narrator's id, or
 * with nothing when closed.
 */
@Component({
  selector: 'app-narrator-choice-dialog',
  templateUrl: './narrator-choice-dialog.html',
  styleUrl: './narrator-choice-dialog.scss',
  imports: [IonButton, IonIcon, TranslatePipe],
})
export class NarratorChoiceDialog implements OnDestroy {
  @Input() lang = '';
  @Input() version = '';
  @Input() choices: BibleNarrator[] = [];
  /** Ids of the narrators whose every chapter is already on the device. */
  @Input() downloaded: string[] = [];

  // Signals: both change from <audio> events, outside any template handler,
  // and the app runs without zone.js, so plain fields would not repaint.
  /** Id of the narrator whose sample is playing. */
  readonly playing = signal<string | undefined>(undefined);
  /** Id of the narrator whose sample could not be played (offline, file missing). */
  readonly failed = signal<string | undefined>(undefined);

  audioFactory: (url: string) => SampleAudio = url => new Audio(url);

  private modalCtrl = inject(ModalController);
  private player = inject(AudioService);
  private audio?: SampleAudio;

  toggleSample(narratorId: string): void {
    const wasPlaying = this.playing() === narratorId;
    this.stopSample();
    if (wasPlaying) return;

    // Not over whatever chapter is playing in the app.
    this.player.pause();
    this.failed.set(undefined);

    const audio = this.audioFactory(audioUrl(this.lang, this.version, SAMPLE_BOOK_IDX, SAMPLE_CHAPTER, narratorId));
    // Events of a sample that was already replaced or stopped are ignored.
    const current = () => this.audio === audio;
    audio.addEventListener('timeupdate', () => {
      if (current() && audio.currentTime >= SAMPLE_SECONDS) this.stopSample();
    });
    audio.addEventListener('ended', () => { if (current()) this.stopSample(); });
    const fail = () => {
      if (!current()) return;
      this.stopSample();
      this.failed.set(narratorId);
    };
    audio.addEventListener('error', fail);

    this.audio = audio;
    this.playing.set(narratorId);
    void Promise.resolve(audio.play()).catch(fail);
  }

  choose(narratorId: string): void {
    this.stopSample();
    void this.modalCtrl.dismiss(narratorId, 'selected');
  }

  close(): void {
    this.stopSample();
    void this.modalCtrl.dismiss(undefined, 'cancel');
  }

  ngOnDestroy(): void {
    this.stopSample();
  }

  private stopSample(): void {
    const audio = this.audio;
    this.audio = undefined;
    this.playing.set(undefined);
    audio?.pause();
  }
}
