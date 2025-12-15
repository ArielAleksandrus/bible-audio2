import { Component, ChangeDetectorRef, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from '../../services/audio.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { BibleService, BookDownloadStatus } from '../../services/bible.service';
import { Track } from '../../models/track';

import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { BiblePicker, Bible, BibleSelection, OverridableCSS as BibleCSS } from 'bible-picker';

import { MatDialog } from '@angular/material/dialog';
import { LanguageSelectorDialog } from '../../language-selector-dialog/language-selector-dialog';

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

  bibleData?: Bible;

  // we use indexes, so if we want to paint chapter 1, we'll use this.customCSS = {"b": {}, "c": {0: "..."} "v": {}}
  customCSS: BibleCSS = {"b": {}, "c": {}, "v": {}};

  constructor(
    private audioService: AudioService,
    private dlServ: AudioDownloaderService,
    private bibleServ: BibleService,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog
  ) {}

  ngOnInit() {
    // force language selection if not found
    if(!localStorage.getItem("selectedBible"))
      this.openLanguageSelector();
    else
      this.init();
  }

  init() {
    console.log(localStorage.getItem("selectedBible"));
    this.bibleData = <Bible>JSON.parse(localStorage.getItem("selectedBible") || "");
    this.checkDownloaded();
  }

  checkDownloaded() {
    if(!this.bibleData) {
      console.error("home.ts::checkDownloaded -> no bibleData found");
      return;
    }
    this.painting = true;
    this.customCSS = {"b": {}, "c": {}, "v": {}};
    this.bibleServ.booksDownloadStatus(this.bibleData).then((booksStatus: BookDownloadStatus[]) => {
      this.booksDownloadStatus = booksStatus;
      this.paintBooks();
    });
  }

  openLanguageSelector() {
    const dialogRef = this.dialog.open(LanguageSelectorDialog, {
      width: '320px',
      disableClose: true,     // can't close by clicking outside
      hasBackdrop: true,
      backdropClass: 'dark-backdrop'
    });

    dialogRef.afterClosed().subscribe(async (langVersion: string) => {
      if (langVersion) {
        let bible: Bible|undefined = await this.bibleServ.loadBibleVersion(langVersion);
        if(!bible) {
          alert("Error fetching bible version. Select another language");
          this.openLanguageSelector();
          return;
        }
        this.init();
      }
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
    if(!this.bibleData) {
      console.error("home.ts::paintChapters -> No bible data found");
      return;
    }
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
    if(!this.bibleData) {
      console.error("home.ts::bpSelected -> No bible data found");
      return;
    }
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
