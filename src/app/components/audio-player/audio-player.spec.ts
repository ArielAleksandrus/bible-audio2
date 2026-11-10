import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioPlayer } from './audio-player';
import { AudioService } from '../../services/audio.service';
import { PreferencesService } from '../../services/preferences.service';
import { Track } from '../../models/track';
import { appTestProviders } from '../../../testing/test-providers';

describe('AudioPlayer', () => {
  let component: AudioPlayer;
  let fixture: ComponentFixture<AudioPlayer>;
  let el: HTMLElement;

  const track: Track = {
    id: 'ara-Gn-1', book: 'Gênesis', chapter: 1, title: 'Gênesis 1', fileName: '',
    url: 'https://cdn.example/GEN 1.mp3', status: 'done', lang: 'pt', version: 'ara', bookIdx: 0, abbrev: 'Gn',
  };

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AudioPlayer],
      providers: appTestProviders(),
    })
    .compileComponents();

    fixture = TestBed.createComponent(AudioPlayer);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    TestBed.inject(AudioService).currentTrack$.next(track);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => TestBed.inject(AudioService).currentTrack$.next(null));

  const chips = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.chip'));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('offers 1x, 1.25x and 1.5x, with 1x selected by default', () => {
    expect(chips().map(c => c.textContent?.trim())).toEqual(['1x', '1.25x', '1.5x']);
    expect(chips().map(c => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(el.querySelector('.speed-note')).toBeNull();
  });

  it('saves the chosen speed and shows the notice only at 1.5x, which stays selectable', () => {
    chips()[1].click();
    fixture.detectChanges();
    expect(TestBed.inject(PreferencesService).playbackRate).toBe(1.25);
    expect(localStorage.getItem('playbackRate')).toBe('1.25');
    expect(el.querySelector('.speed-note')).toBeNull();

    chips()[2].click();
    fixture.detectChanges();
    expect(TestBed.inject(PreferencesService).playbackRate).toBe(1.5);
    expect(chips()[2].getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.speed-note')).not.toBeNull();
  });

  it('shows no narrator control for a version with a single voice', () => {
    expect(el.querySelector('.narrator')).toBeNull();
  });
});
