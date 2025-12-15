import { Injectable } from '@angular/core';
import { Track } from '../models/track';
import { Bible, BibleBook } from 'bible-picker';
import { Plan, DailyGoal, ReadingPortion } from "../models/plan";
import { AudioDownloaderService } from './audio-downloader.service';


export const BIBLE_AUDIO_URL = "https://nlabs.live:3003/assets/bible/audio";
export type BookDownloadStatus = {
  abbrev: string,
  total: number,
  pendingCount: number,
  pending: string[]
};

@Injectable({ providedIn: 'root' })
export class BibleService {

  constructor(private ads: AudioDownloaderService) {

  }

  async loadBibleVersion(versionCode: string): Promise<Bible|undefined> {
    const baseUrl = 'https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev/jsons/';
    const url = `${baseUrl}${versionCode}.json`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Falha ao carregar');
      const jsonData = await response.json();
      if(!jsonData) {
        console.error("BibleService::loadBibleVersion -> invalid format", response);
        throw new Error("BibleService::loadBibleVersion -> invalid format");
      }


      console.log(`Bíblia carregada: ${versionCode}`);
      localStorage.setItem('selectedBible', JSON.stringify(jsonData));
      return <Bible>jsonData;
    } catch (error) {
      console.error("BibleService::loadBibleVersion -> error fetching", error);
      console.error("BibleService::loadBibleVersion -> error fetching", error);
    }

    return undefined;
  }

  removeBibleVersion() {
    localStorage.removeItem("selectedBible");
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
      for (let chapter = 1; chapter <= book.chapters.length; chapter++) {
        if(chapters && chapters.indexOf(chapter) == -1) continue;

        const title = `${book.name} ${chapter}`;
        let track: Track = {
          id: `${bible.version}-${book.abbrev}-${chapter}`,
          book: book.name,
          chapter,
          title,
          fileName: `${title}.mp3`,
          url: `${BIBLE_AUDIO_URL}/${encodeURIComponent(book.name)}/${encodeURIComponent(title)}.mp3`,
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
        url: `${BIBLE_AUDIO_URL}/${encodeURIComponent(book.name)}/${encodeURIComponent(title)}.mp3`,
        status: 'pending'
      };
      let downloaded = await this.ads.isDownloaded(track);
      if(downloaded) track.status = "done";
      tracks.push(track);
    }

    return tracks;
  }

  async downloadPlanDay(bible: Bible, plan: Plan, day: number) {
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
    let tracks: Track[] = [];
    for(let book of bible.books) {
      let bookTracks = await this.downloadBook(bible, book.abbrev);
      tracks = [...tracks, ...bookTracks];
    }
    return tracks;
  }
}
