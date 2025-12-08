import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioPlayer } from './audio-player';

describe('AudioPlayer', () => {
  let component: AudioPlayer;
  let fixture: ComponentFixture<AudioPlayer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AudioPlayer]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AudioPlayer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
