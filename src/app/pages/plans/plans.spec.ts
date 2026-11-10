import { TestBed } from '@angular/core/testing';

import { Plans } from './plans';
import { appTestProviders } from '../../../testing/test-providers';
import { AudioService } from '../../services/audio.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { PlanStatsService } from '../../services/plan-stats.service';
import { PreferencesService } from '../../services/preferences.service';
import { Plan } from '../../models/plan';
import { Track } from '../../models/track';

describe('Plans', () => {
  const plan = (id: string, extra: Partial<Plan> = {}): Plan => ({ id, title: id, days: 1, goals: [], ...extra });
  const track = (id: string): Track =>
    ({ id, book: 'João', chapter: 1, title: id, fileName: '', url: `https://cdn.example/${id}.mp3`, status: 'done' });

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Plans],
      providers: appTestProviders(),
    }).compileComponents();
  });

  it('orders started plans by most recent use', () => {
    const fixture = TestBed.createComponent(Plans);
    const plans = fixture.componentInstance;
    const plan = (id: string, extra: object) => ({ id, title: id, days: 1, goals: [], ...extra });
    plans.startedPlans = [
      plan('old', { lastUsedAt: 1_000 }),
      plan('saved-only', { updatedAt: 3_000 }),
      plan('started-only', { startedAt: new Date(2_000).toISOString() }),
      plan('recent', { lastUsedAt: 5_000, updatedAt: 100 }),
    ];
    (plans as unknown as { sortStartedPlans(): void }).sortStartedPlans();
    expect(plans.startedPlans.map(p => p.id)).toEqual(['recent', 'saved-only', 'started-only', 'old']);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Plans);
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('started / available lists', () => {
    it('shows 5 plans per page and no pager for 5 or fewer', () => {
      const plans = TestBed.createComponent(Plans).componentInstance;
      const five = ['a', 'b', 'c', 'd', 'e'].map(id => plan(id));
      expect(plans.pageCountOf(five)).toBe(1);
      expect(plans.pageOf(five, 0).length).toBe(5);

      const seven = [...five, plan('f'), plan('g')];
      expect(plans.pageCountOf(seven)).toBe(2);
      expect(plans.pageOf(seven, 0).map(p => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(plans.pageOf(seven, 1).map(p => p.id)).toEqual(['f', 'g']);
      // a page past the end (the list shrank) falls back to the last one
      expect(plans.pageOf(seven, 9).map(p => p.id)).toEqual(['f', 'g']);
    });

    it('keeps the catalog order until a sort is chosen, then sorts three ways', () => {
      const plans = TestBed.createComponent(Plans).componentInstance;
      plans.availablePlans = [plan('m', { title: 'Meio', days: 7 }), plan('z', { title: 'Zebra', days: 90 }), plan('a', { title: 'água', days: 30 })];
      expect(plans.sortedAvailable.map(p => p.id)).toEqual(['m', 'z', 'a']);

      plans.setSort('days');
      expect(plans.sortedAvailable.map(p => p.id)).toEqual(['z', 'a', 'm']);

      plans.setSort('alpha');
      expect(plans.sortedAvailable.map(p => p.id)).toEqual(['a', 'm', 'z']);

      plans.stats = { m: { starts: 1, completions: 0, listens: 50 }, a: { starts: 9, completions: 9, listens: 3 } };
      plans.setSort('listens');
      expect(plans.sortedAvailable.map(p => p.id)).toEqual(['m', 'a', 'z']);
      expect(TestBed.inject(PreferencesService).planSort).toBe('listens');

      // tapping the active mode clears it
      plans.setSort('listens');
      expect(plans.sortedAvailable.map(p => p.id)).toEqual(['m', 'z', 'a']);
      expect(TestBed.inject(PreferencesService).planSort).toBeNull();
    });

    it('"most listened" falls back to the catalog order when the stats could not be fetched', () => {
      const plans = TestBed.createComponent(Plans).componentInstance;
      plans.availablePlans = [plan('m', { days: 7 }), plan('z', { days: 90 })];
      plans.stats = null;
      plans.setSort('listens');
      expect(plans.sortedAvailable.map(p => p.id)).toEqual(['m', 'z']);
    });
  });

  describe('playing a plan', () => {
    function setup() {
      const fixture = TestBed.createComponent(Plans);
      const plans = fixture.componentInstance;
      const audio = TestBed.inject(AudioService);
      const stats = TestBed.inject(PlanStatsService);
      const tracks = [track('j1'), track('j2')];
      vi.spyOn(plans, 'buildTracks').mockResolvedValue(tracks);
      vi.spyOn(TestBed.inject(AudioDownloaderService), 'download').mockResolvedValue(undefined);
      vi.spyOn(TestBed.inject(AudioDownloaderService), 'downloadTracks').mockResolvedValue(undefined);
      const playPlaylist = vi.spyOn(audio, 'playPlaylist').mockResolvedValue(undefined);
      const loadPlaylist = vi.spyOn(audio, 'loadPlaylist').mockResolvedValue(undefined);
      const countListen = vi.spyOn(stats, 'countListen').mockImplementation(() => {});
      const countStart = vi.spyOn(stats, 'countStart').mockImplementation(() => {});
      vi.spyOn(stats, 'fetchAll').mockResolvedValue(null);
      const myPlan = plan('p1', { days: 2, goals: [{ day: 1, portions: [] }, { day: 2, portions: [] }] });
      plans.currentPlan = myPlan;
      plans.ngOnInit();
      return { plans, audio, tracks, playPlaylist, loadPlaylist, countListen, countStart, myPlan };
    }
    /** What the engine reports once audio really starts. */
    function playbackBegins(audio: AudioService, t: Track) {
      audio.currentTrack$.next(t);
      audio.isPlaying$.next(true);
    }

    afterEach(() => {
      const audio = TestBed.inject(AudioService);
      audio.isPlaying$.next(false);
      audio.currentTrack$.next(null);
    });

    it('with "play on selection" off, resuming a plan loads it without calling play', async () => {
      TestBed.inject(PreferencesService).setAutoplay(false);
      const { plans, playPlaylist, loadPlaylist } = setup();
      await plans.play(false);
      expect(loadPlaylist).toHaveBeenCalled();
      expect(playPlaylist).not.toHaveBeenCalled();
    });

    it('with "play on selection" on, selecting a plan plays it', async () => {
      const { plans, playPlaylist, loadPlaylist } = setup();
      await plans.play(false);
      expect(playPlaylist).toHaveBeenCalled();
      expect(loadPlaylist).not.toHaveBeenCalled();
    });

    it('the play button of a day always plays, even with "play on selection" off', async () => {
      TestBed.inject(PreferencesService).setAutoplay(false);
      const { plans, playPlaylist, loadPlaylist, myPlan } = setup();
      plans.playGoal(myPlan.goals[1]);
      await vi.waitFor(() => expect(playPlaylist).toHaveBeenCalled());
      expect(loadPlaylist).not.toHaveBeenCalled();
      expect(plans.currentDay).toBe(2);
    });

    it('counts one listen when playback of a day really starts, not for the chapters that follow', async () => {
      const { plans, audio, tracks, countListen, playPlaylist, myPlan } = setup();
      plans.playGoal(myPlan.goals[0]);
      await vi.waitFor(() => expect(playPlaylist).toHaveBeenCalled());
      expect(countListen).not.toHaveBeenCalled(); // asked for, not playing yet

      playbackBegins(audio, tracks[0]);
      expect(countListen).toHaveBeenCalledTimes(1);
      expect(countListen).toHaveBeenCalledWith('p1');

      // pause/resume and the automatic next chapter
      audio.isPlaying$.next(false);
      audio.isPlaying$.next(true);
      playbackBegins(audio, tracks[1]);
      expect(countListen).toHaveBeenCalledTimes(1);
    });

    it('does not count a listen for a resume or for opening a plan without audio', async () => {
      const { plans, audio, tracks, countListen, playPlaylist, myPlan } = setup();
      plans.openPlan(myPlan);
      plans.resumePlan(myPlan);
      await vi.waitFor(() => expect(playPlaylist).toHaveBeenCalled());
      playbackBegins(audio, tracks[0]);
      expect(countListen).not.toHaveBeenCalled();
    });

    it('does not count a listen while something else is what is playing', async () => {
      const { plans, audio, countListen, playPlaylist, myPlan } = setup();
      plans.playGoal(myPlan.goals[0]);
      await vi.waitFor(() => expect(playPlaylist).toHaveBeenCalled());
      playbackBegins(audio, track('a-chapter-picked-on-home'));
      expect(countListen).not.toHaveBeenCalled();
    });

    it('counts the listen even though the player says "playing" before it switches chapter', async () => {
      const { plans, audio, tracks, countListen, playPlaylist, myPlan } = setup();
      audio.currentTrack$.next(track('previous-playlist'));
      plans.playGoal(myPlan.goals[0]);
      await vi.waitFor(() => expect(playPlaylist).toHaveBeenCalled());

      audio.isPlaying$.next(true);          // the <audio> element's `play` event…
      expect(countListen).not.toHaveBeenCalled();
      audio.currentTrack$.next(tracks[0]);  // …then the engine announces the chapter
      expect(countListen).toHaveBeenCalledTimes(1);
    });

    it('with "play on selection" off, a started plan counts its listen when the user presses play', async () => {
      TestBed.inject(PreferencesService).setAutoplay(false);
      const { plans, audio, tracks, countListen, loadPlaylist, myPlan } = setup();
      plans.startPlan(myPlan);
      await vi.waitFor(() => expect(loadPlaylist).toHaveBeenCalled());
      audio.currentTrack$.next(tracks[0]);  // loaded, not playing
      expect(countListen).not.toHaveBeenCalled();
      audio.isPlaying$.next(true);
      expect(countListen).toHaveBeenCalledTimes(1);
    });
  });
});
