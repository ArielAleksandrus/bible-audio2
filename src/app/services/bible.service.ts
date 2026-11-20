import { Injectable, inject } from '@angular/core';
import { Track } from '../models/track';
import { Bible, BibleBook } from 'bible-picker';
import { Plan, DailyGoal, ReadingPortion } from "../models/plan";
import { AudioDownloaderService, BulkDownloadStrings, DownloadProgress } from './audio-downloader.service';
import { WakeLockService } from './wake-lock.service';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

import {
  AUDIO_FORMATS, AudioFormat, audioFormatFor, audioRev, catalogEntry, baseLang, defaultNarrator, hasNameOnlyKeys, narratorChoices, narratorOf,
  voiceHasBook,
} from '../data/bible-catalog';
import { PreferencesService } from './preferences.service';
import { bookDisplayName } from '../utils/bible-text.util';
import { saveBibleVersion, getBibleVersion, getAllSavedBibles, deleteBibleVersion, AvailableSpace } from '../storage/my-db';
import { isNativeApp, nativePlatform } from '../utils/platform.util';
import { setStoredRev, storedRev } from '../storage/audio-revs';

/** Key prefix, in the revisions map, of a saved Bible text (catalog `textRev`). */
const TEXT_REV_PREFIX = 'text:';


export const BIBLE_CDN_URL = "https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev";
export const BIBLE_ABBREV_ISO = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT",
  "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST",
  "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM",
  "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC",
  "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
  "MAT", "MRK", "LUK", "JHN", "ACT", "ROM",
  "1CO", "2CO", "GAL", "EPH", "PHP", "COL",
  "1TH", "2TH", "1TI", "2TI", "TIT", "PHM",
  "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN",
  "JUD", "REV"
];
/**
 * The CDN folder of a version's audio, with the narrator's own folder when
 * the voice is not the version's default. The default voice (first
 * narrator) has none, so a version keeps its paths when it gets a second
 * voice, and no file is ever stored twice.
 */
function versionFolder(lang: string, version: string, narratorId?: string): string {
  const own = narratorId && narratorId !== defaultNarrator(catalogEntry(lang, version)) ? `${narratorId}/` : '';
  return `${BIBLE_CDN_URL}/audios/${baseLang(lang)}/${version.toUpperCase()}/${own}`;
}

/**
 * CDN path of one chapter's audio, in the format this device downloads the
 * version in (audioFormatFor): .mp3 unless the catalog offers a better one.
 */
export function audioUrl(lang: string, version: string, bookIdx: number, chapter: number, narratorId?: string): string {
  const iso = BIBLE_ABBREV_ISO[bookIdx].toUpperCase();
  const { ext } = AUDIO_FORMATS[audioFormatFor(catalogEntry(lang, version))];
  return `${versionFolder(lang, version, narratorId)}${iso}/${iso} ${chapter}.${ext}`;
}

/**
 * CDN path of a narrator's sample: an optional short clip, chosen by whoever
 * uploads the voice, for "hear it before choosing". When it does not exist
 * the app plays the opening of Genesis 1 instead (NarratorChoiceDialog).
 */
export function sampleUrl(lang: string, version: string, narratorId: string): string {
  return `${versionFolder(lang, version, narratorId)}sample.mp3`;
}

/** Download/storage key of one chapter's audio. The narrator is part of it, so two voices never share a file. */
export function trackId(version: string, abbrev: string, chapter: number, narratorId?: string): string {
  return narratorId ? `${version}-${narratorId}-${abbrev}-${chapter}` : `${version}-${abbrev}-${chapter}`;
}

/**
 * The same chapters, read by another narrator (undefined = the version has
 * no choice). Tracks that don't say where they came from are returned as is.
 */
export function retargetTracks(tracks: Track[], narratorId: string | undefined): Track[] {
  return tracks.map(t => {
    if (!t.lang || !t.version || t.bookIdx == null || !t.abbrev) return t;
    const firstNarrator = narratorChoices(catalogEntry(t.lang, t.version))[0]?.id;
    return {
      ...t,
      id: trackId(t.version, t.abbrev, t.chapter, narratorId),
      url: audioUrl(t.lang, t.version, t.bookIdx, t.chapter, narratorId),
      fileName: narratorId && narratorId === firstNarrator ? trackId(t.version, t.abbrev, t.chapter) : '',
      narrator: narratorId,
      status: 'pending' as const,
    };
  });
}

export type BookDownloadStatus = {
  abbrev: string,
  total: number,
  pendingCount: number,
  pending: string[],
  /** false: the voice in use has no narration of this book yet (catalog `books`). */
  available: boolean,
};

/**
 * Rough size of one chapter, for a voice the catalog gives no `bytes` for:
 * a whole Bible (1189 chapters) of OTB in Opus 32 kbps is ~1.1 GB, in MP3
 * 48 kbps ~1.65 GB.
 */
const CHAPTER_BYTES: Record<AudioFormat, number> = { opus: 0.95e6, mp3: 1.4e6 };

@Injectable({ providedIn: 'root' })
export class BibleService {
  // Public progress observable for components
  private progressSubject = new BehaviorSubject<DownloadProgress>({ downloaded: 0, total: 0, status: 'idle' });

  downloadProgress$: Observable<DownloadProgress> = this.progressSubject.asObservable();

  // Progress for the Bible *text* JSON download specifically (a few MB,
  // separate from the audio-download progress above). null when idle.
  private textProgressSubject = new BehaviorSubject<{ loaded: number; total: number } | null>(null);
  textDownloadProgress$: Observable<{ loaded: number; total: number } | null> = this.textProgressSubject.asObservable();

  /** Emits the Bible now in use after switchVersion() changes it. */
  readonly bibleChanged$ = new Subject<Bible>();

  private prefs = inject(PreferencesService);

  constructor(
    private ads: AudioDownloaderService,
    private wakeLock: WakeLockService
  ) {
    // Forward progress from AudioDownloaderService
    this.ads.downloadProgress$.subscribe(progress => {
      this.progressSubject.next(progress);
    });
  }

  buildURL(lang: string, version: string, bookIdx: number, chapter: number, narratorId?: string) {
    return audioUrl(lang, version, bookIdx, chapter, narratorId);
  }

  /** The narrator in use for this Bible: undefined unless its version offers a choice. */
  narratorOf(bible: Bible): string | undefined {
    return this.prefs.narratorFor(catalogEntry(bible.language, bible.version));
  }

  /** Storage key of a chapter of this Bible, for the narrator currently selected. */
  trackIdFor(bible: Bible, bookAbbrev: string, chapter: number): string {
    return trackId(bible.version, bookAbbrev, chapter, this.narratorOf(bible));
  }

  private buildTrack(bible: Bible, bookIdx: number, chapter: number, narratorId: string | undefined): Track {
    const book = bible.books[bookIdx];
    const title = `${bookDisplayName(book)} ${chapter}`;
    const entry = catalogEntry(bible.language, bible.version);
    const firstNarrator = narratorChoices(entry)[0]?.id;
    const rev = audioRev(entry, narratorId, BIBLE_ABBREV_ISO[bookIdx], chapter);

    // Storage keys this chapter may already be saved under from before:
    // - "Gênesis 1.mp3": the key used before ids existed. It names no
    //   version, so it is only trusted for the versions that existed then
    //   (hasNameOnlyKeys).
    // - the id without a narrator: what the first narrator's chapters were
    //   saved as while he was the version's only voice.
    let legacyKey = '';
    if (!narratorId) {
      if (book.name && hasNameOnlyKeys(bible.language, bible.version)) legacyKey = `${book.name} ${chapter}.mp3`;
    } else if (narratorId === firstNarrator) {
      legacyKey = trackId(bible.version, book.abbrev, chapter);
    }

    return {
      id: trackId(bible.version, book.abbrev, chapter, narratorId),
      book: bookDisplayName(book),
      chapter,
      title,
      fileName: legacyKey,
      url: audioUrl(bible.language, bible.version, bookIdx, chapter, narratorId),
      status: 'pending',
      lang: baseLang(bible.language),
      version: bible.version,
      bookIdx,
      abbrev: book.abbrev,
      narrator: narratorId,
      ...(rev > 1 ? { rev } : {}),
    };
  }

  /**
   * Switch to another version of a language without touching the ones
   * already saved: fetches its text if this device doesn't have it yet,
   * makes it the selected Bible and tells every page (bibleChanged$).
   * Audio built from now on uses the new version.
   */
  async switchVersion(lang: string, version: string): Promise<Bible | undefined> {
    const bible = await this.downloadAndSaveBible(baseLang(lang), version);
    if (!bible) return undefined;
    localStorage.setItem('selectedBible', `${baseLang(lang)}-${version}`);
    this.bibleChanged$.next(bible);
    return bible;
  }

  async downloadAndSaveBible(language: string, versionName: string): Promise<Bible|undefined> {
    const url = `${BIBLE_CDN_URL}/jsons/${language}-${versionName}.json`;
    const key = language + "-" + versionName;
    const textRev = catalogEntry(language, versionName)?.textRev ?? 1;
    let found = await this.loadBibleVersion(language, versionName);
    if(found) {
      if (textRev > storedRev(TEXT_REV_PREFIX + key)) void this.refreshText(url, key, versionName, language, textRev);
      return found;
    }

    const space = new AvailableSpace();
    if (!(await space.isSafe(50))) { // deixa 50MB livres
      window.alert('Espaço insuficiente no dispositivo');
      return;
    }

    try {
      this.textProgressSubject.next({ loaded: 0, total: 0 });
      const bibleData = await this.fetchJsonWithProgress(url);

      await saveBibleVersion(key, versionName, language, key, bibleData);
      setStoredRev(TEXT_REV_PREFIX + key, textRev);

      return <Bible>bibleData;
    } catch (err) {
      console.error('Erro ao baixar Bíblia:', err);
    } finally {
      this.textProgressSubject.next(null);
    }
    return undefined;
  }

  /**
   * Fetch a corrected text (catalog `textRev` above the stored one) over the
   * saved copy, quietly: the old text stays in use until the new one is
   * saved, and stays if the download fails (tried again on the next open).
   */
  private async refreshText(url: string, key: string, versionName: string, language: string, textRev: number): Promise<void> {
    try {
      const bibleData = await this.fetchJsonWithProgress(url, false);
      await saveBibleVersion(key, versionName, language, key, bibleData);
      setStoredRev(TEXT_REV_PREFIX + key, textRev);
    } catch (err) {
      console.warn('Texto corrigido não baixado agora:', err);
    }
  }

  // fetch() alone gives no progress feedback for a multi-MB response — read
  // the stream manually so the UI can show real download progress instead
  // of an indefinite "loading" spinner.
  private async fetchJsonWithProgress(url: string, progress = true): Promise<unknown> {
    if (isNativeApp()) {
      // Native HTTP: the WebView's origin (https://localhost /
      // capacitor://localhost) isn't one the CDN's CORS policy knows about.
      // No streamed progress here, so the loading screen shows an
      // indeterminate bar instead.
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({ url, responseType: 'json' });
      if (res.status < 200 || res.status >= 300) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    if (!response.body) return response.json();

    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (progress) this.textProgressSubject.next({ loaded, total });
    }

    const text = await new Blob(chunks as BlobPart[]).text();
    return JSON.parse(text);
  }

  async loadBibleVersion(language: string, versionName: string): Promise<Bible|undefined> {
    const id = language + "-" + versionName;

    let obj = await getBibleVersion(id);

    if(obj) {
      return obj.data;
    } else {
      return undefined;
    }
  }

  // Clears the selected-language flag AND every cached Bible text JSON —
  // without the latter, re-picking the same language would just return the
  // stale cached copy from IndexedDB instead of re-fetching (e.g. after a
  // CDN correction to that language's file).
  async removeBibleVersion() {
    localStorage.removeItem("selectedBible");
    const saved = await getAllSavedBibles();
    await Promise.all(saved.map(b => deleteBibleVersion(b.id)));
  }

  /**
   * Of the narrators this Bible lets the user choose between, the ids of the
   * ones whose every chapter is already on the device. Empty when the version
   * offers no choice.
   */
  async narratorsDownloaded(bible: Bible): Promise<string[]> {
    const done: string[] = [];
    for (const narrator of narratorChoices(catalogEntry(bible.language, bible.version))) {
      if (await this.isVoiceComplete(bible, narrator.id)) done.push(narrator.id);
    }
    return done;
  }

  /** Whether at least one voice of this Bible is complete on the device: then the full download is no longer offered on Home. */
  async anyVoiceComplete(bible: Bible): Promise<boolean> {
    const choices = narratorChoices(catalogEntry(bible.language, bible.version));
    if (!choices.length) return this.isVoiceComplete(bible, undefined);
    return (await this.narratorsDownloaded(bible)).length > 0;
  }

  /**
   * Genesis 1 in each narrator's voice, for the ones that have it on the
   * device: what a sample falls back to with no connection.
   */
  async localSamples(bible: Bible): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    if (!bible.books.length) return found;
    for (const narrator of narratorChoices(catalogEntry(bible.language, bible.version))) {
      const url = await this.ads.localUrl(this.buildTrack(bible, 0, 1, narrator.id));
      if (url) found[narrator.id] = url;
    }
    return found;
  }

  /**
   * Every chapter a voice has so far (the books in its catalog `books`, or
   * all of them). undefined = the version offers no choice of narrator.
   */
  voiceTracks(bible: Bible, narratorId: string | undefined): Track[] {
    const entry = catalogEntry(bible.language, bible.version);
    const tracks: Track[] = [];
    bible.books.forEach((book, bookIdx) => {
      if (!voiceHasBook(entry, narratorId, BIBLE_ABBREV_ISO[bookIdx])) return;
      for (let chapter = 1; chapter <= book.chapters.length; chapter++) {
        tracks.push(this.buildTrack(bible, bookIdx, chapter, narratorId));
      }
    });
    return tracks;
  }

  /** Every chapter the voice has so far is on the device (and it has at least one). */
  async isVoiceComplete(bible: Bible, narratorId: string | undefined): Promise<boolean> {
    const tracks = this.voiceTracks(bible, narratorId);
    if (!tracks.length) return false;
    for (const track of tracks) {
      if (!(await this.ads.isDownloaded(track))) return false;
    }
    return true;
  }

  /**
   * About how many bytes a full download of this voice still needs, in the
   * format this device downloads: the catalog's `bytes` for the voice when it
   * has them, else an estimate per chapter; minus what is already here.
   */
  async voiceBytesToDownload(bible: Bible, narratorId: string | undefined): Promise<number> {
    const entry = catalogEntry(bible.language, bible.version);
    const format = audioFormatFor(entry);
    const tracks = this.voiceTracks(bible, narratorId);
    if (!tracks.length) return 0;
    let pending = 0;
    for (const track of tracks) if (!(await this.ads.isDownloaded(track))) pending++;
    const whole = narratorOf(entry, narratorId)?.bytes?.[format] ?? tracks.length * CHAPTER_BYTES[format];
    return Math.round(whole * pending / tracks.length);
  }

  /** Deletes every chapter of one voice from the device (also under the keys it was saved with before). */
  async removeVoice(bible: Bible, narratorId: string | undefined): Promise<void> {
    for (let bookIdx = 0; bookIdx < bible.books.length; bookIdx++) {
      for (let chapter = 1; chapter <= bible.books[bookIdx].chapters.length; chapter++) {
        const track = this.buildTrack(bible, bookIdx, chapter, narratorId);
        await this.ads.removeById(track.id);
        if (track.fileName) await this.ads.removeById(track.fileName);
      }
    }
  }

  async booksDownloadStatus(bible: Bible): Promise<BookDownloadStatus[]> {
    let res: BookDownloadStatus[] = [];

    for(let book of bible.books) {
      const tracks: Track[] = await this.genTracks(bible, book.abbrev);
      const stats: {total: number, pendingCount: number, pending: string[]} = await this.ads.areDownloaded(tracks);
      const available = this.bookAvailable(bible, bible.books.indexOf(book));
      res.push({
        abbrev: book.abbrev,
        total: stats.total,
        // A book not narrated yet is not "missing" from the device.
        pendingCount: available ? stats.pendingCount : 0,
        pending: available ? stats.pending : [],
        available,
      });
    }
    return res;
  }

  /** Whether the voice in use has this book yet (catalog `books`). */
  bookAvailable(bible: Bible, bookIdx: number): boolean {
    const entry = catalogEntry(bible.language, bible.version);
    return voiceHasBook(entry, this.narratorOf(bible), BIBLE_ABBREV_ISO[bookIdx]);
  }

  async genTracks(bible: Bible, bookAbbrev?: string, chapters?: number[]): Promise<Track[]> {
    const tracks: Track[] = [];
    let bibleBooks = bible.books;
    if(bookAbbrev) {
      const found: BibleBook|undefined = bible.books.find(item => item.abbrev === bookAbbrev);
      if(found)
        bibleBooks = [found];
      else {
        console.error("BibleService::genTracks: ", `cannot find bible book by abbrev '${bookAbbrev}'`, bible);
        throw new Error("BibleService::genTracks: " + `cannot find bible book by abbrev '${bookAbbrev}'`)
      }
    }

    const narratorId = this.narratorOf(bible);
    for (const book of bibleBooks) {
      const bookIdx = bible.books.indexOf(book);
      for (let chapter = 1; chapter <= book.chapters.length; chapter++) {
        if(chapters && chapters.indexOf(chapter) == -1) continue;


        const track = this.buildTrack(bible, bookIdx, chapter, narratorId);

        let downloaded = await this.ads.isDownloaded(track)
        if(downloaded) track.status = "done";

        tracks.push(track);
      }
    }

    return tracks;
  }

  async genDailyPlanTracks(bible: Bible, plan: Plan, day: number): Promise<Track[]> {
    const tracks: Track[] = [];

    let goal: DailyGoal|undefined = plan.goals.find(item => item.day === day);
    if(!goal) {
      console.warn(`BibleService::genDailyPlanTracks -> Day ${day} not found on plan: `, plan);
      return [];
    }

    const narratorId = this.narratorOf(bible);
    for(let portion of goal.portions) {
      const track = this.buildTrack(bible, portion.bookIdx, portion.chapter, narratorId);
      let downloaded = await this.ads.isDownloaded(track);
      if(downloaded) track.status = "done";
      tracks.push(track);
    }

    return tracks;
  }

  async downloadPlanDay(bible: Bible, plan: Plan, day: number): Promise<Track[]> {
    const tracks: Track[] = await this.genDailyPlanTracks(bible, plan, day);
    const pending: Track[] = tracks.filter(item => item.status != "done");

    for(let track of pending) {
      await this.ads.download(track);
    }

    return tracks;
  }

  async downloadBook(bible: Bible, bookAbbrev: string): Promise<Track[]> {
    const tracks: Track[] = await this.genTracks(bible, bookAbbrev);
    const pending: Track[] = tracks.filter(item => item.status != "done");

    for(let track of pending) {
      await this.ads.download(track);
    }

    return tracks;
  }

  /**
   * Downloads every chapter the given voices have so far (catalog `books`),
   * one voice after the other in a single batch. Default: the voice in use.
   * Resolves with the tracks of the batch once it is over.
   */
  async downloadEntireBible(
    bible: Bible, strings: BulkDownloadStrings, narratorIds: (string | undefined)[] = [this.narratorOf(bible)],
  ): Promise<Track[]> {
    // Reset progress
    this.progressSubject.next({ downloaded: 0, total: 0, status: 'running', context: 'full-bible' });

    const allTracks: Track[] = [];
    for (const narratorId of narratorIds) {
      for (const track of this.voiceTracks(bible, narratorId)) {
        if (await this.ads.isDownloaded(track)) track.status = 'done';
        allTracks.push(track);
      }
    }

    const pendingTracks = allTracks.filter(t => t.status !== 'done');

    // Native: a foreground service on Android, which doesn't need the
    // screen on. Web/iOS: keep the screen from auto-locking while this runs.
    // Doesn't survive a manual power-button lock — see WakeLockService —
    // but that's handled by downloadTracks()'s own stall detection instead.
    const holdScreen = nativePlatform() !== 'android';
    if (holdScreen) await this.wakeLock.request();
    try {
      // Progress flows through downloadProgress$.
      await this.ads.downloadInBackground(pendingTracks, strings);
    } finally {
      if (holdScreen) this.wakeLock.release();
    }

    return allTracks;
  }
}
