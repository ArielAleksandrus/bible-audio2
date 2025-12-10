import { Component, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { AudioService } from '../../services/audio.service';
import { Track } from '../../models/track';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-audio-player',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSliderModule,
  ],
  templateUrl: './audio-player.html',
  styleUrls: ['./audio-player.scss'],
})
export class AudioPlayer implements OnDestroy {
  currentTrack: Track | null = null;
  isPlaying = false;
  currentTime = 0;
  duration = 0;

  private subs = new Subscription();

  constructor(
    public audioService: AudioService,
    private cdr: ChangeDetectorRef
  ) {
    this.subs.add(
      this.audioService.currentTrack$.subscribe(track => {
        this.currentTrack = track;
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

  seek(percentage: number) {
    this.audioService.seekTo(this.duration * percentage / 100);
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
