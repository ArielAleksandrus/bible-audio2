import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from '../../services/audio.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { Track } from '../../models/track';

import { BiblePicker, Bible, BibleSelection, BibleARA, BibleKJV } from 'bible-picker';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
  imports: [CommonModule, BiblePicker],
  standalone: true
})
export class Home implements OnInit {
  // Our two test tracks: Jeremias 49 and 50
  tracks: Track[] = [];
  currentTrackIndex = 0;
  downloading = false;

  bibleBR = BibleARA;
  bibleEN = BibleKJV;
  bibleData = BibleARA;

  constructor(
    private audioService: AudioService,
    private downloader: AudioDownloaderService,
    private cdr: ChangeDetectorRef
  ) {}

  onVerseSelected(ref: any) {
  console.log('Selected:', ref);
  // Example output:
  // { book: "Gênesis", abbreviation: "Gn", chapter: 1, verse: 1, text: "No princípio, criou Deus..." }
}

  ngOnInit() {
    // Build only the two Jeremias tracks we want for testing
    this.downloader.getAllTracks().then(tracks => {
      this.tracks = tracks.filter(t =>
        t.book === 'Jeremias' && (t.chapter >= 40 && t.chapter <= 50)
      );

      // Optional: sort just in case
      this.tracks.sort((a, b) => a.chapter - b.chapter);
      this.cdr.detectChanges();
    });

  }

  get completedCount(): number {
    return this.tracks.filter(t => t.status == "done").length;
  }

  get remainingCount(): number {
    return this.tracks.length - this.completedCount;
  }

  private async isDownloaded(track: Track): Promise<boolean> {
    return await this.downloader.isDownloaded(track);
  }

  // Download both chapters with nice visual feedback
  async downloadAll() {
    this.downloading = true;

    for (const track of this.tracks) {
      if (await this.isDownloaded(track)) {
        track['status'] = 'done';
        continue;
      }

      track['status'] = 'downloading';

      try {
        await this.downloader.download(track);
        track['status'] = 'done';
      } catch (err) {
        console.error('Download failed:', track.title, err);
        track['status'] = 'error';
      }

      this.cdr.detectChanges();
    }

    this.downloading = false;
  }

  // PLAYBACK CONTROLS
  async play(index?: number) {
    if (typeof index === 'number') {
      this.currentTrackIndex = index;
    }

    const track = this.tracks[this.currentTrackIndex];

    // This automatically plays from IndexedDB if exists, or downloads + plays if not
    await this.audioService.playTrack(track);
  }

  pause() {
    this.audioService.pause();
  }

  resume() {
    this.audioService.play();
  }

  async next() {
    this.currentTrackIndex = (this.currentTrackIndex + 1) % this.tracks.length;
    await this.play();
  }

  async prev() {
    this.currentTrackIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
    await this.play();
  }

  // Helper to get current track for template
  get currentTrack(): Track | null {
    return this.tracks[this.currentTrackIndex] || null;
  }
}
export default Home;
