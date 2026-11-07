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
});
