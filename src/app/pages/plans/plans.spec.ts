import { TestBed } from '@angular/core/testing';

import { Plans } from './plans';
import { appTestProviders } from '../../../testing/test-providers';

describe('Plans', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Plans],
      providers: appTestProviders(),
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Plans);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
