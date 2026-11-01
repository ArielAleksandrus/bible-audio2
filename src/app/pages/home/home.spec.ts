import { TestBed } from '@angular/core/testing';

import { Home } from './home';
import { appTestProviders } from '../../../testing/test-providers';

describe('Home', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: appTestProviders(),
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Home);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
