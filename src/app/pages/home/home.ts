import { Component, ChangeDetectorRef, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { AudioService } from '../../services/audio.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { BibleService, BookDownloadStatus } from '../../services/bible.service';
import { AvailableSpace } from '../../storage/my-db';
import { Track } from '../../models/track';

import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';

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
      MatProgressSpinnerModule,
      MatProgressBarModule,
      MatButtonModule,
      TranslateModule
  ],
  standalone: true,
  encapsulation: ViewEncapsulation.None // faz o css definido em home.scss penetrar o bible-picker
})
export class Home implements OnInit {
  tracks: Track[] = [];
  booksDownloadStatus: BookDownloadStatus[] = [];
  currentTrackIndex = 0;
  downloading = false;
  painting = false;

  bibleData?: Bible;

  // we use indexes, so if we want to paint chapter 1, we'll use this.customCSS = {"b": {}, "c": {0: "..."} "v": {}}
  customCSS: BibleCSS = {"b": {}, "c": {}, "v": {}};

  availableMB = 0;

  progress$;

  constructor(
    private audioService: AudioService,
    private dlServ: AudioDownloaderService,
    private bibleServ: BibleService,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog,
    private translate: TranslateService
  ) {
    this.progress$ = this.bibleServ.downloadProgress$;
  }

  ngOnInit() {
    // calculate Storage
    let availableSpace = new AvailableSpace();
    availableSpace.inMB().then(res => {
      this.availableMB = res;
    });

    // force language selection if not found
    if(!localStorage.getItem("selectedBible"))
      this.openLanguageSelector();
    else
      this.init();
  }

  init() {
    let selected = localStorage.getItem("selectedBible");
    if(!selected) {
      this.openLanguageSelector();
      return;
    }
    this.bibleServ.loadBibleVersion(selected.split("-")[0], selected.split("-")[1]).then(res => {
      if(res) {
        this.bibleData = res;
        const savedLang = this.bibleData.language;
        if(savedLang) {
          this.translate.use(savedLang);
        }
        this.checkDownloaded();

        this.cdr.detectChanges();
      } else {
        this.openLanguageSelector();
      }
    });
  }

  fullDownload(): Promise<Track[]> {
    // Verifica se está em Wi-Fi
    if (!this.isOnWifi()) {
      const confirm = window.confirm(
        this.translate.instant('hero.confirm_mobile_data') ||
        'Você não está conectado ao Wi-Fi. O download da Bíblia inteira usa cerca de 1.3 GB de dados. Deseja continuar mesmo assim?'
      );
      if (!confirm) {
        return new Promise(res => res([])); // Usuário cancelou
      }
    }

    let bd = this.bibleData;
    if(!bd)
      return new Promise(res => res([]));
    else
      return new Promise(res => res(this.bibleServ.downloadEntireBible(bd)));
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
        localStorage.setItem("selectedBible", langVersion);
        let bible: Bible|undefined = await this.bibleServ.downloadAndSaveBible(langVersion.split("-")[0], langVersion.split("-")[1]);
        if(!bible) {
          alert("Error fetching bible version. Select another language");
          localStorage.removeItem("selectedBible");
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

  private isOnWifi(): boolean {
    // Verifica a API Network Information (suportada na maioria dos navegadores modernos e PWAs)
    // @ts-ignore – pois nem todos os tipos TypeScript incluem isso ainda
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;

    if (connection) {
      // Tipo de conexão: 'wifi', 'cellular', 'ethernet', 'none', 'unknown'
      return connection.type !== 'cellular';
    }

    // Fallback: se a API não estiver disponível, suponha que NÃO é wifi
    return false;
  }
}
export default Home;
