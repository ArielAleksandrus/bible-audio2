import { TestBed } from '@angular/core/testing';

import { Home } from './home';
import { appTestProviders } from '../../../testing/test-providers';
import { AudioService } from '../../services/audio.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { BibleService } from '../../services/bible.service';
import { PreferencesService } from '../../services/preferences.service';
import { Bible } from 'bible-picker';

describe('Home', () => {
  const bible = {
    version: 'ara',
    language: 'pt-br',
    books: [
      { abbrev: 'Gn', name: 'Gênesis', chapters: [['No princípio, criou Deus os céus e a terra.'], ['Assim foram acabados os céus.']] },
      { abbrev: 'Jo', name: 'João', chapters: [['No princípio era o Verbo.', 'Ele estava no princípio com Deus.']] },
    ],
  } as unknown as Bible;

  function setup() {
    const fixture = TestBed.createComponent(Home);
    const home = fixture.componentInstance;
    home.bibleData = bible;
    const audio = TestBed.inject(AudioService);
    const downloader = TestBed.inject(AudioDownloaderService);
    vi.spyOn(downloader, 'isDownloaded').mockResolvedValue(false);
    vi.spyOn(downloader, 'download').mockResolvedValue(undefined);
    vi.spyOn(downloader, 'downloadTracks').mockResolvedValue(undefined);
    const playPlaylist = vi.spyOn(audio, 'playPlaylist').mockResolvedValue(undefined);
    const loadPlaylist = vi.spyOn(audio, 'loadPlaylist').mockResolvedValue(undefined);
    return { home, playPlaylist, loadPlaylist, downloader };
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: appTestProviders(),
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Home);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('plays a selected chapter when "play on selection" is on (the default)', async () => {
    const { home, playPlaylist, loadPlaylist } = setup();
    await home.bpSelected({ books: [bible.books[0]], chapters: [1], verses: [] });
    expect(playPlaylist).toHaveBeenCalled();
    expect(loadPlaylist).not.toHaveBeenCalled();
    expect(home.showTextViewer).toBe(true);
  });

  it('with "play on selection" off, a selected chapter is downloaded, queued and shown, but not played', async () => {
    TestBed.inject(PreferencesService).setAutoplay(false);
    const { home, playPlaylist, loadPlaylist, downloader } = setup();
    await home.bpSelected({ books: [bible.books[0]], chapters: [1, 2], verses: [] });

    expect(playPlaylist).not.toHaveBeenCalled();
    expect(downloader.download).toHaveBeenCalled();
    expect(loadPlaylist).toHaveBeenCalledTimes(1);
    expect(loadPlaylist.mock.calls[0][0].map(t => t.id)).toEqual(['ara-Gn-1', 'ara-Gn-2']);
    expect(home.showTextViewer).toBe(true);
    expect(home.textChapters).toEqual([1, 2]);
  });

  it('builds today\'s audio URL for the current versions', async () => {
    const { home, playPlaylist } = setup();
    await home.bpSelected({ books: [bible.books[1]], chapters: [1], verses: [] });
    // bookIdx 1 is Exodus in the canonical ISO list this URL is built from
    expect(playPlaylist.mock.calls[0][0][0].url)
      .toBe('https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev/audios/pt/ARA/EXO/EXO 1.mp3');
  });

  it('finds verses ignoring accents and opens the text at the verse found', async () => {
    const { home, playPlaylist } = setup();
    home.onSearch('principio');
    expect(home.searchHits.map(h => `${home.bookName(h.bookIdx)} ${h.chapter}:${h.verse}`))
      .toEqual(['Gênesis 1:1', 'João 1:1', 'João 1:2']);
    expect(home.searchHits[0].match).toBe('princípio');

    await home.openSearchHit(home.searchHits[2]);
    expect(home.showTextViewer).toBe(true);
    expect(home.textBook).toBe(bible.books[1]);
    expect(home.textChapters).toEqual([1]);
    expect(home.textVerse).toBe(2);
    expect(playPlaylist).toHaveBeenCalled(); // autoplay is on by default
  });

  it('a search result does not start audio when "play on selection" is off', async () => {
    TestBed.inject(PreferencesService).setAutoplay(false);
    const { home, playPlaylist, loadPlaylist } = setup();
    home.onSearch('verbo');
    await home.openSearchHit(home.searchHits[0]);
    expect(home.showTextViewer).toBe(true);
    expect(playPlaylist).not.toHaveBeenCalled();
    expect(loadPlaylist).toHaveBeenCalled();
  });

  it('switching version keeps the language and repoints the page at the new Bible', async () => {
    const { home } = setup();
    const other = { ...bible, version: 'otb' } as unknown as Bible;
    const service = TestBed.inject(BibleService);
    vi.spyOn(service, 'downloadAndSaveBible').mockResolvedValue(other);
    vi.spyOn(service, 'booksDownloadStatus').mockResolvedValue([]);

    await service.switchVersion('pt-br', 'otb');

    expect(localStorage.getItem('selectedBible')).toBe('pt-otb');
    expect(home.bibleData).toBe(other);
  });
});
