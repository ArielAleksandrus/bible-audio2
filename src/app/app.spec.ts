import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { appTestProviders } from '../testing/test-providers';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: appTestProviders(),
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
