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
});
