import { Component, Input, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { IonButton, IonIcon, ModalController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { BibleNarrator } from '../data/bible-catalog';
import { AudioService } from '../services/audio.service';
import { VolumeCheckService } from '../services/volume-check.service';
import { audioUrl, sampleUrl } from '../services/bible.service';
import { SPACE_MARGIN_BYTES, formatSize } from '../utils/format-size.util';

/** How much of the sample chapter is played. */
export const SAMPLE_SECONDS = 15;

/** The chapter a voice is sampled with when it has no sample of its own: Genesis 1, the first one any narration has. */
const SAMPLE_BOOK_IDX = 0;
const SAMPLE_CHAPTER = 1;

/** The part of HTMLAudioElement the sample uses; tests swap the factory. */
export type SampleAudio = Pick<HTMLAudioElement, 'play' | 'pause' | 'addEventListener' | 'currentTime'>;

/**
 * "Which narrators?" before a full-Bible download of a version read by two or
 * more voices: a checkbox per voice, with its size, and at least one must be
 * ticked; several can be, to switch between them offline later. Voices
 * already complete on the device are shown as such and can't be ticked.
 * The total is compared with the free space when it is known (web).
 *
 * Each voice can be heard first, for SAMPLE_SECONDS at most. The play
 * button tries, in order: the narrator's own sample on the CDN (optional),
 * Genesis 1 in that voice from the device when it is downloaded (so it
 * works offline), and Genesis 1 streamed from the CDN.
 *
 * Dismisses with the ids ticked, or with nothing when closed.
 */
@Component({
  selector: 'app-narrator-choice-dialog',
  templateUrl: './narrator-choice-dialog.html',
  styleUrl: './narrator-choice-dialog.scss',
  imports: [IonButton, IonIcon, TranslatePipe],
})
export class NarratorChoiceDialog implements OnInit, OnDestroy {
  @Input() lang = '';
  @Input() version = '';
  @Input() choices: BibleNarrator[] = [];
  /** Ids of the narrators whose every chapter is already on the device. */
  @Input() downloaded: string[] = [];
  /** Playable URL of Genesis 1 on the device, by narrator id, for the ones that have it. */
  @Input() localSamples: Record<string, string> = {};
  /** Bytes each voice still needs, by narrator id. */
  @Input() sizes: Record<string, number> = {};
  /** Free space on the device, when it can be known. */
  @Input() freeBytes?: number;
  /** Ticked when the dialog opens (the voice in use). */
  @Input() preselected: string[] = [];

  /** Ids ticked. */
  readonly selected = signal<string[]>([]);
  readonly totalBytes = computed(() => this.selected().reduce((sum, id) => sum + (this.sizes[id] ?? 0), 0));
  /** The free space is known and the ticked voices don't fit in it with some room to spare. */
  readonly tooBig = computed(() => this.freeBytes !== undefined && this.totalBytes() + SPACE_MARGIN_BYTES > this.freeBytes);

  // Signals: both change from <audio> events, outside any template handler,
  // and the app runs without zone.js, so plain fields would not repaint.
  /** Id of the narrator whose sample is playing. */
  readonly playing = signal<string | undefined>(undefined);
  /** Id of the narrator whose sample could not be played (offline, file missing). */
  readonly failed = signal<string | undefined>(undefined);

  audioFactory: (url: string) => SampleAudio = url => new Audio(url);

  private modalCtrl = inject(ModalController);
  private player = inject(AudioService);
  private translate = inject(TranslateService);
  private volume = inject(VolumeCheckService);
  private audio?: SampleAudio;

  ngOnInit(): void {
    this.selected.set(this.preselected.filter(id => !this.downloaded.includes(id) && this.choices.some(n => n.id === id)));
  }

  isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  toggle(id: string): void {
    if (this.downloaded.includes(id)) return;
    this.selected.update(ids => ids.includes(id) ? ids.filter(x => x !== id) : this.choices.map(n => n.id).filter(x => x === id || ids.includes(x)));
  }

  size(bytes: number): string {
    return formatSize(bytes, this.translate.currentLang || 'pt');
  }

  toggleSample(narratorId: string): void {
    const wasPlaying = this.playing() === narratorId;
    this.stopSample();
    if (wasPlaying) return;

    // Not over whatever chapter is playing in the app.
    this.player.pause();
    void this.volume.warnIfLow();
    this.failed.set(undefined);

    const local = this.localSamples[narratorId];
    this.playFrom(narratorId, [
      sampleUrl(this.lang, this.version, narratorId),
      ...(local ? [local] : []),
      audioUrl(this.lang, this.version, SAMPLE_BOOK_IDX, SAMPLE_CHAPTER, narratorId),
    ]);
  }

  /** Plays the first source that works; the sample has failed only when none does. */
  private playFrom(narratorId: string, sources: string[]): void {
    const [url, ...rest] = sources;
    const audio = this.audioFactory(url);
    // Events of a sample that was already replaced or stopped are ignored.
    const current = () => this.audio === audio;
    audio.addEventListener('timeupdate', () => {
      if (current() && audio.currentTime >= SAMPLE_SECONDS) this.stopSample();
    });
    audio.addEventListener('ended', () => { if (current()) this.stopSample(); });
    const fail = () => {
      if (!current()) return;
      this.stopSample();
      if (rest.length) this.playFrom(narratorId, rest);
      else this.failed.set(narratorId);
    };
    audio.addEventListener('error', fail);

    this.audio = audio;
    this.playing.set(narratorId);
    void Promise.resolve(audio.play()).catch(fail);
  }

  /** Dismisses with the voices ticked, in the catalog's order. Nothing ticked: nothing happens (the button is disabled). */
  confirm(): void {
    const ids = this.selected();
    if (!ids.length) return;
    this.stopSample();
    void this.modalCtrl.dismiss(ids, 'selected');
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
