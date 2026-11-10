import { Component, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { IonButton, IonIcon, IonRange } from '@ionic/angular';
import { AudioService } from '../../services/audio.service';
import { Track } from '../../models/track';
import { Subscription } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PLAYBACK_RATES, PlaybackRate, PreferencesService } from '../../services/preferences.service';
import { BibleNarrator, catalogEntry, narratorChoices } from '../../data/bible-catalog';

@Component({
  selector: 'app-audio-player',
  imports: [IonButton, IonIcon, IonRange, TranslatePipe],
  templateUrl: './audio-player.html',
  styleUrls: ['./audio-player.scss'],
})
export class AudioPlayer implements OnDestroy {
  currentTrack: Track | null = null;
  isPlaying = false;
  currentTime = 0;
  duration = 0;
  /** While the knob is held, show the drag position instead of live playback time. */
  dragging = false;
  dragValue = 0;

  readonly rates = PLAYBACK_RATES;
  playbackRate: PlaybackRate = 1;
  /** Voices of the version being played; empty (no control shown) unless it has two or more. */
  narrators: BibleNarrator[] = [];

  private subs = new Subscription();

  constructor(
    public audioService: AudioService,
    private cdr: ChangeDetectorRef,
    private prefs: PreferencesService,
    private translate: TranslateService
  ) {
    this.subs.add(
      this.prefs.playbackRate$.subscribe(rate => {
        this.playbackRate = rate;
        this.cdr.markForCheck();
      })
    );

    this.subs.add(
      this.audioService.currentTrack$.subscribe(track => {
        this.currentTrack = track;
        this.narrators = track?.lang && track.version
          ? narratorChoices(catalogEntry(track.lang, track.version))
          : [];
        this.cdr.markForCheck();
      })
    );

    this.subs.add(
      this.audioService.isPlaying$.subscribe(playing => {
        this.isPlaying = playing;
        this.cdr.markForCheck();
      })
    );

    this.subs.add(
      this.audioService.timeUpdate$.subscribe(({ currentTime, duration }) => {
        this.currentTime = currentTime;
        this.duration = duration || 0;
        this.cdr.markForCheck();
      })
    );
  }

  togglePlayPause() {
    this.isPlaying ? this.audioService.pause() : this.audioService.play();
  }

  setRate(rate: PlaybackRate) {
    this.prefs.setPlaybackRate(rate);
  }

  /** "1,25x" in Portuguese/Spanish, "1.25x" in English. */
  rateLabel(rate: number): string {
    let text = String(rate);
    try {
      text = new Intl.NumberFormat(this.translate.currentLang || undefined).format(rate);
    } catch { /* unknown locale: plain number */ }
    return `${text}x`;
  }

  changeNarrator(narratorId: string) {
    void this.audioService.changeNarrator(narratorId);
  }

  onSeekEnd(seconds: number) {
    this.dragging = false;
    if (typeof seconds === 'number' && isFinite(seconds)) this.audioService.seekTo(seconds);
  }

  close() {
    this.audioService.stop();        // para o áudio
    this.audioService.currentTrack$.next(null); // esconde o player
  }

  rewind()   { this.audioService.skip(-10); }
  forward()  { this.audioService.skip(10); }
  prev()     { this.audioService.previous(); }
  next()     { this.audioService.next(); }

  formatTime(seconds: number): string {
    if (!seconds && seconds !== 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
