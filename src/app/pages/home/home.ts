import { Component, ChangeDetectorRef, DestroyRef, OnInit, ViewChild, ViewEncapsulation, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AsyncPipe, DecimalPipe } from '@angular/common';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
  ActionSheetController, IonButton, IonContent, IonHeader, IonIcon, IonProgressBar, IonSearchbar, IonSpinner,
  IonTitle, IonToolbar, ModalController, ViewWillEnter,
} from '@ionic/angular';

import { AudioService } from '../../services/audio.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { BibleService, BookDownloadStatus } from '../../services/bible.service';
import { AvailableSpace } from '../../storage/my-db';
import { Track } from '../../models/track';

import { BiblePicker, Bible, BibleBook, BibleSelection, OverridableCSS as BibleCSS } from 'bible-picker';

import { LanguageSelectorDialog } from '../../language-selector-dialog/language-selector-dialog';
import { BibleTextViewer } from '../../components/bible-text-viewer/bible-text-viewer';
import { AppStateService } from '../../services/app-state.service';
import { InAppBrowserWarningService } from '../../services/in-app-browser-warning.service';
import { InstallPromptService } from '../../services/install-prompt.service';
import { InstallSuggestedDialog } from '../../install-suggested-dialog/install-suggested-dialog';
import { isAppInstalled, isInstagramInAppBrowser, isMobileDevice } from '../../utils/browser.util';
import { isNativeApp } from '../../utils/platform.util';
import { UiService } from '../../services/ui.service';
import { PreferencesService } from '../../services/preferences.service';
import { CatalogService } from '../../services/catalog.service';
import { VoiceDownloadService } from '../../services/voice-download.service';
import { BibleCatalogEntry, catalogEntry, versionsForLanguage } from '../../data/bible-catalog';
import { SearchHit, SearchIndex, buildSearchIndex, searchBible, MIN_QUERY_LENGTH } from '../../utils/bible-search.util';
import { bookDisplayName } from '../../utils/bible-text.util';

/** Search results shown at once; the count of all matches is shown beside them. */
const SEARCH_LIMIT = 30;

// What the picker draws on a book/chapter (bible-picker's customCSS): a
// solid dot on a tinted cell for "downloaded", a hollow dot for "partly".
const MARK_FULL = '--bp-mark: var(--app-downloaded); --bp-mark-ring: var(--app-downloaded); background-color: var(--app-downloaded-bg);';
const MARK_NOT_YET = 'opacity: 0.45;';
const MARK_PARTIAL = '--bp-mark-ring: var(--app-partial); background-color: var(--app-partial-bg);';


@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
  imports: [
    AsyncPipe, DecimalPipe, TranslatePipe,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, IonProgressBar, IonSearchbar, IonSpinner,
    BiblePicker,
    BibleTextViewer,
  ],
  encapsulation: ViewEncapsulation.None // faz o css definido em home.scss penetrar o bible-picker
})
export class Home implements OnInit, ViewWillEnter {
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
  textDownloadProgress$;

  showTextViewer = false;
  textBook?: BibleBook;
  textChapters: number[] = [];
  textVerse?: number;

  @ViewChild(BiblePicker) private picker?: BiblePicker;

  // Text search (runs on the Bible JSON already on the device).
  searchQuery = '';
  searchHits: SearchHit[] = [];
  searchTotal = 0;
  readonly searchLimit = SEARCH_LIMIT;
  readonly minQueryLength = MIN_QUERY_LENGTH;
  private searchIndex?: SearchIndex;

  /** Versions offered for the current language; the switch shows only when there are two or more. */
  versions: BibleCatalogEntry[] = [];
  currentVersion?: BibleCatalogEntry;
  switchingVersion = false;

  private prefs = inject(PreferencesService);
  private voiceDownload = inject(VoiceDownloadService);
  private actionSheets = inject(ActionSheetController);

  constructor(
    private audioService: AudioService,
    private dlServ: AudioDownloaderService,
    private bibleServ: BibleService,
    private cdr: ChangeDetectorRef,
    private modals: ModalController,
    private ui: UiService,
    private translate: TranslateService,
    private appState: AppStateService,
    private inAppBrowserWarning: InAppBrowserWarningService,
    private installServ: InstallPromptService
  ) {
    this.progress$ = this.bibleServ.downloadProgress$;
    this.textDownloadProgress$ = this.bibleServ.textDownloadProgress$;

    // Repaint the picker whenever a full-Bible download ends — finished,
    // failed or cancelled. On Android it runs in a service and can end
    // while the app was closed, so the fullDownload() promise can't be the
    // only trigger.
    const destroyRef = inject(DestroyRef);

    // Another version of the language was chosen (here or in Settings).
    this.bibleServ.bibleChanged$.pipe(takeUntilDestroyed(destroyRef)).subscribe(bible => this.useBible(bible));
    // The list of versions and narrators was updated from the CDN.
    inject(CatalogService).changed$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      const bible = this.bibleData;
      if (!bible) return;
      this.versions = versionsForLanguage(bible.language || '');
      this.currentVersion = catalogEntry(bible.language || '', bible.version);
      this.checkDownloaded();
      this.cdr.detectChanges();
    });
    // Downloads are kept per narrator, so the colouring follows the voice in use.
    this.prefs.narratorChanged$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      if (this.bibleData) this.checkDownloaded();
    });

    let lastFullStatus: string | undefined;
    this.progress$.pipe(takeUntilDestroyed(destroyRef)).subscribe(p => {
      if (p.context !== 'full-bible') return;
      const was = lastFullStatus;
      lastFullStatus = p.status;
      if (was === 'running' && p.status !== 'running' && this.bibleData) this.checkDownloaded();
    });
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

  // Tabs keep this page alive; refresh the downloaded/partial colouring when
  // coming back (e.g. after a plan downloaded chapters from the Plans tab).
  ionViewWillEnter() {
    if (this.bibleData && !this.painting) this.checkDownloaded();
  }

  init() {
    let selected = localStorage.getItem("selectedBible");
    if(!selected) {
      this.openLanguageSelector();
      return;
    }
    // Load translations as soon as the language is known, in parallel with
    // the Bible JSON fetch below, so the loading screen itself can show
    // translated text instead of only the fallback language.
    this.translate.use(selected.split("-")[0]);
    this.bibleServ.loadBibleVersion(selected.split("-")[0], selected.split("-")[1]).then(res => {
      if(res) {
        this.appState.markBibleLoaded();
        this.useBible(res);
      } else {
        this.openLanguageSelector();
      }
    });
  }

  /** Show a Bible (first load, or after a version switch): picker, colouring, search and version switch all follow it. */
  private useBible(bible: Bible) {
    this.bibleData = bible;
    const savedLang = bible.language?.split("-")[0]; // e.g. 'pt-br' -> 'pt'
    if(savedLang) {
      this.translate.use(savedLang);
    }
    this.versions = versionsForLanguage(bible.language || '');
    this.currentVersion = catalogEntry(bible.language || '', bible.version);
    this.searchIndex = undefined;
    this.clearSearch();
    this.showTextViewer = false;
    this.checkDownloaded();
    this.cdr.detectChanges();
  }

  /**
   * There is another version to switch to. `versions` leaves hidden ones
   * out, while the version in use may be one of them (still open on this
   * device), so this is not simply "two or more versions".
   */
  get canSwitchVersion(): boolean {
    return this.versions.some(v => v !== this.currentVersion);
  }

  /** Home shortcut for the version switch (the same switch is in Settings). */
  async chooseVersion() {
    const sheet = await this.actionSheets.create({
      header: this.translate.instant('version.title'),
      buttons: [
        ...this.versions.map(v => ({
          text: v.label,
          cssClass: v === this.currentVersion ? 'action-sheet-selected' : '',
          handler: () => { void this.switchVersion(v); },
        })),
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async switchVersion(entry: BibleCatalogEntry) {
    if (entry === this.currentVersion || this.switchingVersion) return;
    this.switchingVersion = true;
    this.cdr.detectChanges();
    try {
      const bible = await this.bibleServ.switchVersion(entry.lang, entry.version);
      if (!bible) await this.ui.alert(this.translate.instant('version.switch_failed'));
    } finally {
      this.switchingVersion = false;
      this.cdr.detectChanges();
    }
  }

  // ---- text search ----

  onSearch(query: string | null | undefined) {
    this.searchQuery = query || '';
    if (!this.bibleData || this.searchQuery.trim().length < MIN_QUERY_LENGTH) {
      this.searchHits = [];
      this.searchTotal = 0;
      return;
    }
    // Built on the first search, not at startup: most sessions never search.
    this.searchIndex ??= buildSearchIndex(this.bibleData.books);
    const { hits, total } = searchBible(this.searchIndex, this.searchQuery, SEARCH_LIMIT);
    this.searchHits = hits;
    this.searchTotal = total;
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchHits = [];
    this.searchTotal = 0;
  }

  bookName(bookIdx: number): string {
    return bookDisplayName(this.bibleData?.books[bookIdx]);
  }

  /** Open the text at the verse found, with its chapter selected in the picker. */
  async openSearchHit(hit: SearchHit) {
    const book = this.bibleData?.books[hit.bookIdx];
    if (!book) return;
    this.picker?.showChapter(hit.bookIdx, hit.chapter);
    await this.openChapters(book, [hit.chapter], hit.verse);
  }

  async fullDownload(): Promise<Track[]> {
    // Instagram's in-app browser can't run the PWA in the background at
    // all (see browser.util.ts), so a 1.3 GB download there is wasted —
    // play Genesis 1 instead, just to show the app works, and point the
    // user at "open in browser" immediately (no waiting for anything).
    if (isInstagramInAppBrowser()) {
      return this.playFirstChapterFallback().then(tracks => {
        this.inAppBrowserWarning.showNow();
        return tracks;
      });
    }

    // Any other mobile browser (a "real" one, not Instagram) where the app
    // hasn't been installed yet: background audio/offline storage are less
    // reliable in a plain browser tab, so we suggest installing — but it's
    // only a suggestion, not a gate, so the download below still runs.
    // Desktop has no equivalent installed/not-installed expectation, so it
    // never shows this.
    if (!isNativeApp() && isMobileDevice() && !isAppInstalled()) {
      void this.modals.create({ component: InstallSuggestedDialog, cssClass: 'app-dialog' }).then(m => m.present());
    }

    if (!this.bibleData) return [];
    // Which voices, whether they fit, mobile data, then the download. The
    // picker/legend refresh when it settles comes from the progress$
    // subscription in the constructor.
    return this.voiceDownload.chooseAndDownload(this.bibleData);
  }

  // Downloads and plays just Genesis 1, in place of the full-Bible download,
  // so the user can see the app actually works even though the bulk
  // download was blocked. Genesis is always the first book/chapter in
  // canonical order, so this doesn't depend on the current translation.
  private async playFirstChapterFallback(): Promise<Track[]> {
    const bd = this.bibleData;
    if (!bd) return [];
    const firstBook = bd.books[0];
    const tracks = await this.bibleServ.genTracks(bd, firstBook.abbrev, [1]);
    await this.dlServ.download(tracks[0]);
    void this.audioService.playPlaylist(tracks, 0);
    return tracks;
  }

  checkDownloaded() {
    if(!this.bibleData) {
      console.error("home.ts::checkDownloaded -> no bibleData found");
      return;
    }
    this.painting = true;
    this.customCSS = {"b": {}, "c": {}, "v": {}};
    const bible = this.bibleData;
    Promise.all([this.bibleServ.booksDownloadStatus(bible), this.bibleServ.anyVoiceComplete(bible)])
      .then(([booksStatus, complete]) => {
        this.booksDownloadStatus = booksStatus;
        this.bibleFullyDownloaded = complete;
        this.paintBooks();
      });
  }

  async openLanguageSelector() {
    const modal = await this.modals.create({
      component: LanguageSelectorDialog,
      cssClass: 'app-dialog',
      backdropDismiss: false, // a language is required to use the app
    });
    await modal.present();
    const { data: langVersion } = await modal.onDidDismiss<string>();
    {
      if (langVersion) {
        localStorage.setItem("selectedBible", langVersion);
        let bible: Bible|undefined = await this.bibleServ.downloadAndSaveBible(langVersion.split("-")[0], langVersion.split("-")[1]);
        if(!bible) {
          await this.ui.alert("Error fetching bible version. Select another language");
          localStorage.removeItem("selectedBible");
          this.openLanguageSelector();
          return;
        }
        this.appState.markLanguageSelected();
        this.init();
      }
    }
  }


  paintBooks() {
    this.painting = true;
    const booksStatus = this.booksDownloadStatus;

    for(let i = 0; i < booksStatus.length; i++) {
      const stat = booksStatus[i];
      if (!stat.available) {
        // Not narrated yet in the voice in use.
        this.customCSS["b"][i] = MARK_NOT_YET;
      } else if(stat.total > 0) { // something was downloaded
        if(stat.pendingCount == 0) // book was fully downloaded
          this.customCSS["b"][i] = MARK_FULL;
        else //book was partially downloaded
          this.customCSS["b"][i] = MARK_PARTIAL;
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
      if(stats.pending.indexOf(this.bibleServ.trackIdFor(this.bibleData, bookAbbrev, i)) == -1) // chapter was downloaded
        this.customCSS["c"][i - 1] = MARK_FULL;
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
    await this.openChapters(sel.books[0], sel.chapters);
  }

  /**
   * What choosing chapters does, from the picker or from a search result:
   * download the first one, queue them all, open the text. Whether audio
   * starts by itself is the user's "play on selection" setting — turned off,
   * the player is left ready and the user presses play.
   */
  private async openChapters(book: BibleBook, chapters: number[], verse?: number) {
    if(!this.bibleData) return;

    this.textBook = book;
    this.textChapters = chapters;
    this.textVerse = verse;
    this.showTextViewer = true;
    this.cdr.detectChanges();

    this.tracks = await this.bibleServ.genTracks(this.bibleData, book.abbrev, chapters);
    if(this.tracks.length === 0) return;
    this.inAppBrowserWarning.armForNextPlay();
    await this.dlServ.download(this.tracks[0]);
    // Playlist must be set before the first chapter ends, not after every chapter is downloaded.
    void this.audioService.openPlaylist(this.tracks, 0);
    void this.dlServ.downloadTracks(this.tracks);
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

  /**
   * At least one voice of this Bible is complete on the device (every book
   * it has so far): the full download is then no longer offered here, only
   * in Settings, for another voice.
   */
  bibleFullyDownloaded = false;
}
export default Home;
