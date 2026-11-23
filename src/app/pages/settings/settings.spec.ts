import { TestBed } from '@angular/core/testing';

import { Settings } from './settings';
import { appTestProviders } from '../../../testing/test-providers';

describe('Settings', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: appTestProviders(),
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Settings);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('lists the OTB GitHub project, this app and the site under Credits', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const link = (url: string) => root.querySelector(`a[href="${url}"]`);

    const otb = link('https://github.com/OpenTranslationBible/open-bible');
    expect(otb?.querySelector('ion-icon[name="logo-github"]')).toBeTruthy();
    expect(link('https://github.com/ArielAleksandrus/bible-audio2')?.querySelector('ion-icon[name="logo-github"]')).toBeTruthy();
    expect(link('https://biblia.nlabs.live')).toBeTruthy();
    expect(link('https://creativecommons.org/licenses/by-sa/4.0/')).toBeTruthy();
  });
});
