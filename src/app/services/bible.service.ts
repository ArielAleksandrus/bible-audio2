import { Injectable } from '@angular/core';
import { Track } from '../models/track';
import { Bible, BibleBook } from 'bible-picker';
import { Plan, DailyGoal, ReadingPortion } from "../models/plan";
import { AudioDownloaderService } from './audio-downloader.service';
import { BehaviorSubject, Observable } from 'rxjs';

import { saveBibleVersion, getBibleVersion, getAllSavedBibles, deleteBibleVersion, AvailableSpace } from '../storage/my-db';
import { VerseService } from './verse.service';


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
export type BookDownloadStatus = {
  abbrev: string,
  total: number,
  pendingCount: number,
  pending: string[]
};

@Injectable({ providedIn: 'root' })
export class BibleService {
  // Public progress observable for components
  private progressSubject = new BehaviorSubject<{
    downloaded: number;
    total: number;
    currentTrack?: Track;
    status: 'idle' | 'running' | 'completed' | 'error';
  }>({ downloaded: 0, total: 0, status: 'idle' });

  downloadProgress$: Observable<any> = this.progressSubject.asObservable();

  // Progress for the Bible *text* JSON download specifically (a few MB,
  // separate from the audio-download progress above). null when idle.
  private textProgressSubject = new BehaviorSubject<{ loaded: number; total: number } | null>(null);
  textDownloadProgress$: Observable<{ loaded: number; total: number } | null> = this.textProgressSubject.asObservable();

  constructor(private ads: AudioDownloaderService, private verseServ: VerseService) {
    // Forward progress from AudioDownloaderService
    this.ads.downloadProgress$.subscribe(progress => {
      this.progressSubject.next(progress);
    });
  }

  buildURL(lang: string, version: string, bookIdx: number, chapter: number) {
    lang = lang.split("-")[0]; // to make 'pt-br' be 'pt' only
    const abbrevISO = BIBLE_ABBREV_ISO[bookIdx];

    return `${BIBLE_CDN_URL}/audios/${lang}/${version.toUpperCase()}/${abbrevISO.toUpperCase()}/${abbrevISO.toUpperCase()} ${chapter}.mp3`;
  }

  async downloadAndSaveBible(language: string, versionName: string): Promise<Bible|undefined> {
    const url = `${BIBLE_CDN_URL}/jsons/${language}-${versionName}.json`;
    let found = await this.loadBibleVersion(language, versionName);
    if(found)
      return found;

    const space = new AvailableSpace();
    if (!(await space.isSafe(50))) { // deixa 50MB livres
      alert('Espaço insuficiente no dispositivo');
      return;
    }

    try {
      this.textProgressSubject.next({ loaded: 0, total: 0 });
      const bibleData = await this.fetchJsonWithProgress(url);

      await saveBibleVersion(language + "-" + versionName, versionName, language, language + "-" + versionName, bibleData);

      // Derive this language's daily-reminder verses now that we have the
      // full text, so the notification Cron job has them ready to use.
      this.verseServ.deriveVerses(<Bible>bibleData)
        .then(verses => this.verseServ.saveVersesForLanguage(language, verses))
        .catch(err => console.warn('BibleService: failed to derive/save verses', err));

      return <Bible>bibleData;
    } catch (err) {
      console.error('Erro ao baixar Bíblia:', err);
    } finally {
      this.textProgressSubject.next(null);
    }
    return undefined;
  }

  // fetch() alone gives no progress feedback for a multi-MB response — read
  // the stream manually so the UI can show real download progress instead
  // of an indefinite "loading" spinner.
  private async fetchJsonWithProgress(url: string): Promise<unknown> {
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
      this.textProgressSubject.next({ loaded, total });
    }

    const text = await new Blob(chunks as BlobPart[]).text();
    return JSON.parse(text);
  }

  async loadBibleVersion(language: string, versionName: string): Promise<Bible|undefined> {
    const id = language + "-" + versionName;

    let obj = await getBibleVersion(id);

    if(obj)
      return obj.data;
    else
      return undefined;
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

  async booksDownloadStatus(bible: Bible): Promise<BookDownloadStatus[]> {
    let res: BookDownloadStatus[] = [];

    for(let book of bible.books) {
      const tracks: Track[] = await this.genTracks(bible, book.abbrev);
      const stats: {total: number, pendingCount: number, pending: string[]} = await this.ads.areDownloaded(tracks);
      res.push({
        abbrev: book.abbrev,
        total: stats.total,
        pendingCount: stats.pendingCount,
        pending: stats.pending
      });
    }
    return res;
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

    for (const book of bibleBooks) {
      const bookIdx = bible.books.indexOf(book);
      for (let chapter = 1; chapter <= book.chapters.length; chapter++) {
        if(chapters && chapters.indexOf(chapter) == -1) continue;


        const title = `${book.name} ${chapter}`;
        let track: Track = {
          id: `${bible.version}-${book.abbrev}-${chapter}`,
          book: book.name,
          chapter,
          title,
          fileName: `${title}.mp3`,
          url: this.buildURL(bible.language, bible.version, bookIdx, chapter),
          status: 'pending'
        };

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

    for(let portion of goal.portions) {
      const book = bible.books[portion.bookIdx];
      const chapter = portion.chapter;

      const title = `${book.name} ${chapter}`;
      let track: Track = {
        id: `${bible.version}-${book.abbrev}-${chapter}`,
        book: book.name,
        chapter,
        title,
        fileName: `${title}.mp3`,
        url: this.buildURL(bible.language, bible.version, portion.bookIdx, chapter),
        status: 'pending'
      };
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

  async downloadEntireBible(bible: Bible): Promise<Track[]> {
    // Reset progress
    this.progressSubject.next({ downloaded: 0, total: 0, status: 'running' });

    const allTracks: Track[] = [];

    for (const book of bible.books) {
      const bookTracks = await this.genTracks(bible, book.abbrev);
      allTracks.push(...bookTracks);
    }

    // Filter only pending tracks (optional optimization)
    const pendingTracks = allTracks.filter(t => t.status !== 'done');

    // Start the bulk download – progress will flow automatically
    await this.ads.downloadTracks(pendingTracks);

    // Return all tracks (with updated status)
    return allTracks;
  }
}
