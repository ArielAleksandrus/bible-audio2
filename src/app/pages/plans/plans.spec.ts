import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Plans } from './plans';
import { appTestProviders } from '../../../testing/test-providers';
import { BibleService } from '../../services/bible.service';
import { PlanService } from '../../services/plan.service';
import { dbPromise } from '../../storage/my-db';
import { Plan } from '../../models/plan';

const plan = (id: string, extra: Partial<Plan> = {}): Plan => ({
  id, title: id, days: 1, status: 'started',
  goals: [{ day: 1, portions: [{ bookIdx: 0, chapter: 1 }] }],
  ...extra,
});

describe('Plans', () => {
  beforeEach(async () => {
    localStorage.setItem('selectedBible', 'pt-ARA');
    const db = await dbPromise;
    await db.clear('plans');
    await db.clear('plan_completions');
    await TestBed.configureTestingModule({
      imports: [Plans],
      providers: [
        ...appTestProviders(),
        // The page only needs the chosen Bible's metadata here.
        { provide: BibleService, useValue: { loadBibleVersion: async () => ({ language: 'pt', version: 'ARA', books: [] }) } },
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  async function openPage() {
    const fixture = TestBed.createComponent(Plans);
    fixture.detectChanges();
    const page = fixture.componentInstance;
    await vi.waitFor(() => expect(page.startedPlans.length).toBeGreaterThan(0));
    // The page renders its lists once the bundled plan catalogue has loaded
    // (fetched one file at a time); serve each request as it is made.
    const http = TestBed.inject(HttpTestingController);
    for (let i = 0; i < 5; i++) {
      const req = await vi.waitFor(() => {
        const [r] = http.match(() => true);
        if (!r) throw new Error('waiting for the plan catalogue');
        return r;
      });
      req.flush(plan(`catalogue-${i}`, { status: undefined }));
    }
    await vi.waitFor(() => expect(page.availablePlans.length).toBeGreaterThan(0));
    await fixture.whenStable();
    return { page, fixture };
  }

  /** Tap a started plan's "Abrir" button, as the user would. */
  async function tapOpen(fixture: Awaited<ReturnType<typeof openPage>>['fixture'], index: number) {
    const cards = fixture.nativeElement.querySelectorAll('ion-card.plan-item');
    const open = [...cards[index].querySelectorAll('ion-button')]
      .find(b => (b as HTMLElement).getAttribute('fill') === 'outline') as HTMLElement;
    open.click();
    await fixture.whenStable();
  }

  it('should create', () => {
    expect(TestBed.createComponent(Plans).componentInstance).toBeTruthy();
  });

  it('lists started plans most recently used first', async () => {
    const plans = TestBed.inject(PlanService);
    // save() stamps updatedAt with "now", so give each plan its own clock.
    const at = (t: number) => vi.spyOn(Date, 'now').mockReturnValue(t);
    at(1_000); await plans.save(plan('old', { lastUsedAt: 1_000 }));
    at(3_000); await plans.save(plan('saved-only'));
    // A plan stored before updatedAt/lastUsedAt existed: only startedAt.
    await (await dbPromise).put('plans', plan('started-only', { startedAt: new Date(2_000).toISOString() }));
    at(4_000); await plans.save(plan('recent', { lastUsedAt: 5_000 }));
    vi.restoreAllMocks();

    const { page } = await openPage();
    expect(page.startedPlans.map(p => p.id)).toEqual(['recent', 'saved-only', 'started-only', 'old']);
  });

  it('moves a plan to the top when it is opened, and remembers that after a reload', async () => {
    const plans = TestBed.inject(PlanService);
    await plans.save(plan('a', { lastUsedAt: 2_000 }));
    await plans.save(plan('b', { lastUsedAt: 1_000 }));

    const { page, fixture } = await openPage();
    expect(page.startedPlans.map(p => p.id)).toEqual(['a', 'b']);

    await tapOpen(fixture, 1);
    expect(page.currentPlan?.id).toBe('b');
    expect(page.startedPlans.map(p => p.id)).toEqual(['b', 'a']);
    await vi.waitFor(async () => expect((await plans.get('b'))!.lastUsedAt).toBeGreaterThan(2_000));

    const reloaded = await openPage(); // a fresh page reads from storage again
    expect(reloaded.page.startedPlans.map(p => p.id)).toEqual(['b', 'a']);
  });

  it('does not list completed plans among the started ones', async () => {
    const plans = TestBed.inject(PlanService);
    await plans.save(plan('done', { status: 'completed', lastUsedAt: 9_000 }));
    await plans.save(plan('going'));
    const { page } = await openPage();
    expect(page.startedPlans.map(p => p.id)).toEqual(['going']);
    expect(page.completedPlans.map(p => p.id)).toEqual(['done']);
  });

  it('moves a plan from "available" to "started" as soon as it is started', async () => {
    const plans = TestBed.inject(PlanService);
    await plans.save(plan('other'));
    const { page, fixture } = await openPage();
    vi.spyOn(page, 'play').mockResolvedValue(); // playback is covered elsewhere

    const cards = [...fixture.nativeElement.querySelectorAll('ion-card.plan-item')] as HTMLElement[];
    const toStart = cards.find(c => c.querySelector('ion-card-title')?.textContent?.trim() === 'catalogue-0')!;
    (toStart.querySelector('ion-button') as HTMLElement).click();

    await vi.waitFor(() => expect(page.startedPlans.map(p => p.id)).toContain('catalogue-0'));
    // The catalogue is re-read from the network; serve it again.
    const http = TestBed.inject(HttpTestingController);
    for (let i = 0; i < 5; i++) {
      const req = await vi.waitFor(() => {
        const [r] = http.match(() => true);
        if (!r) throw new Error('waiting for the plan catalogue');
        return r;
      });
      req.flush(plan(`catalogue-${i}`, { status: undefined }));
    }
    await vi.waitFor(() => expect(page.availablePlans.map(p => p.id)).not.toContain('catalogue-0'));
    await fixture.whenStable();
  });
});

