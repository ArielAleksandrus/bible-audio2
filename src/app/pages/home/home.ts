import { Component, ChangeDetectorRef, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from '../../services/audio.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { BibleService, BookDownloadStatus } from '../../services/bible.service';
import { Track } from '../../models/track';

import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { BiblePicker, Bible, BibleSelection, OverridableCSS as BibleCSS, BibleARA, BibleKJV } from 'bible-picker';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
  imports: [CommonModule,
      BiblePicker,
      MatIconModule,
      MatProgressSpinnerModule
  ],
  standalone: true,
  encapsulation: ViewEncapsulation.None // faz o css definido em home.scss penetrar o bible-picker
})
export class Home implements OnInit {
  // Our two test tracks: Jeremias 49 and 50
  tracks: Track[] = [];
  booksDownloadStatus: BookDownloadStatus[] = [];
  currentTrackIndex = 0;
  downloading = false;
  painting = false;

  bibleData = BibleARA;

  // we use indexes, so if we want to paint chapter 1, we'll use this.customCSS = {"b": {}, "c": {0: "..."} "v": {}}
  customCSS: BibleCSS = {"b": {}, "c": {}, "v": {}};

  constructor(
    private audioService: AudioService,
    private dlServ: AudioDownloaderService,
    private bibleServ: BibleService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // Build Ageu (ag) tracks for testing purposes
    this.bibleServ.downloadBook(this.bibleData, 'Ag').then(tracks => {
      this.tracks = tracks;
      this.tracks.sort((a, b) => a.chapter - b.chapter);
      this.cdr.detectChanges();
    });

    // Check downloaded files
    this.checkDownloaded();

    if(!localStorage.getItem("bible-version"))
      localStorage.setItem("bible-version", "ara");
  }

  checkDownloaded() {
    this.painting = true;
    this.customCSS = {"b": {}, "c": {}, "v": {}};
    this.bibleServ.booksDownloadStatus(this.bibleData).then((booksStatus: BookDownloadStatus[]) => {
      this.booksDownloadStatus = booksStatus;
      this.paintBooks();
    });
  }

  paintBooks() {
    this.painting = true;
    const booksStatus = this.booksDownloadStatus;

    for(let i = 0; i < booksStatus.length; i++) {
      const stat = booksStatus[i];
      if(stat.total > 0) { // something was downloaded
        if(stat.pendingCount == 0) // book was fully downloaded
          this.customCSS["b"][i] = "background-color: lightgreen;";
        else //book was partially downloaded
          this.customCSS["b"][i] = "background-color: lightyellow;";
      } else { // nothing was downloaded
        // do nothing
      }
    }
    this.painting = false;
    this.cdr.detectChanges();
  }
  paintChapters(bookAbbrev: string) {
    this.painting = true;
    this.customCSS = {"b": {}, "c": {}, "v": {}};
    const booksStatus = this.booksDownloadStatus;
    const stats = booksStatus.find(item => item.abbrev === bookAbbrev);
    if(!stats)
      return;

    for(let i = 1; i <= stats.total + stats.pendingCount; i++) {
      if(stats.pending.indexOf(`${this.bibleData.version}-${bookAbbrev}-${i}`) == -1) // chapter was downloaded
        this.customCSS["c"][i - 1] = "background-color: lightgreen";
    }
    this.painting = false;
    this.cdr.detectChanges();
  }

  bpSelecting(sel: BibleSelection) {
    if(sel.books[0]) // book was selected
      this.paintChapters(sel.books[0].abbrev);
    else // book was not selected
      this.paintBooks();
  }
  async bpSelected(sel: BibleSelection) {
    this.tracks = await this.bibleServ.genTracks(this.bibleData, sel.books[0].abbrev, sel.chapters);
    await this.dlServ.download(this.tracks[0]);
    this.audioService.playTrack(this.tracks[0]).then(_ => {});
    this.dlServ.downloadTracks(this.tracks).then(_ => {
      this.audioService.setPlaylist(this.tracks);
    });
  }

  async playTrackFromHere(track: Track, index: number) {
    if (track.status !== 'done') return;

    // Usa o AudioService global com a playlist certa
    await this.audioService.playPlaylist(this.tracks, index);
  }

  get completedCount(): number {
    return this.tracks.filter(t => t.status == "done").length;
  }

  get remainingCount(): number {
    return this.tracks.length - this.completedCount;
  }
}
export default Home;
