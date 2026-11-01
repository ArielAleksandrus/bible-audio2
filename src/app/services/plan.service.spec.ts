import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { PlanService } from './plan.service';
import { dbPromise } from '../storage/my-db';
import { Plan } from '../models/plan';

function plan(id: string, done: boolean[][] = [[false]]): Plan {
  return {
    id, title: id, days: done.length,
    goals: done.map((portions, i) => ({
      day: i + 1,
      completed: portions.every(Boolean),
      portions: portions.map((completed, j) => ({ bookIdx: 0, chapter: i * 10 + j + 1, completed })),
    })),
  };
}

describe('PlanService', () => {
  let service: PlanService;

  beforeEach(async () => {
    const db = await dbPromise;
    await db.clear('plans');
    await db.clear('plan_completions');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(PlanService);
  });

  describe('persistence', () => {
    it('saves, reads back and lists plans', async () => {
      await service.save(plan('a'));
      await service.save(plan('b'));
      expect((await service.get('a'))?.id).toBe('a');
      expect((await service.getAll()).map(p => p.id).sort()).toEqual(['a', 'b']);
    });

    it('stamps updatedAt on every save and announces it (for cloud sync)', async () => {
      const saved = vi.fn();
      service.planSaved$.subscribe(saved);
      vi.spyOn(Date, 'now').mockReturnValue(1234);
      const p = plan('a');
      await service.save(p);
      expect((await service.get('a'))?.updatedAt).toBe(1234);
      expect(saved).toHaveBeenCalledWith(p);
      vi.restoreAllMocks();
    });

    it('keeps lastUsedAt so the started list can be ordered by recent use after a reload', async () => {
      await service.save({ ...plan('a'), lastUsedAt: 42 });
      expect((await service.get('a'))?.lastUsedAt).toBe(42);
    });

    it('deletes a plan and announces the deletion', async () => {
      const deleted = vi.fn();
      service.planDeleted$.subscribe(deleted);
      await service.save(plan('a'));
      await service.delete('a');
      expect(await service.get('a')).toBeUndefined();
      expect(deleted).toHaveBeenCalledWith('a');
    });
  });

  describe('stoppedAt', () => {
    it('points at the first unread portion of the first unfinished day', () => {
      const p = plan('a', [[true, true], [true, false, false], [false]]);
      expect(service.stoppedAt(p)).toEqual({ day: 2, portionIdx: 1 });
    });

    it('is day 1, portion 0 for a fresh plan', () => {
      expect(service.stoppedAt(plan('a', [[false, false], [false]]))).toEqual({ day: 1, portionIdx: 0 });
    });

    it('reports day -1 once every day is completed', () => {
      expect(service.stoppedAt(plan('a', [[true], [true]])).day).toBe(-1);
    });
  });

  it('scores progress by completed portions (used to merge devices)', () => {
    expect(service.progressScore(plan('a', [[true, false], [true, true]]))).toBe(3);
    expect(service.progressScore(plan('b', [[false]]))).toBe(0);
  });

  describe('completion counts', () => {
    it('starts at zero and increments per completion', async () => {
      expect(await service.getCompletionCount('a')).toBe(0);
      expect(await service.incrementCompletionCount('a')).toBe(1);
      expect(await service.incrementCompletionCount('a')).toBe(2);
      expect(await service.getAllCompletionCounts()).toEqual({ a: 2 });
    });

    it('announces every change', async () => {
      const changed = vi.fn();
      service.completionCountChanged$.subscribe(changed);
      await service.setCompletionCount('b', 5);
      expect(changed).toHaveBeenCalledWith({ planId: 'b', count: 5 });
    });
  });

  describe('fetchPlans', () => {
    it('loads the bundled plans and skips any that fail', async () => {
      const http = TestBed.inject(HttpTestingController);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = service.fetchPlans();
      const ids = ['first-steps', 'new-testament', 'christmas', 'easter', 'valley-of-shadow'];
      for (const id of ids) {
        // Requests are made one after another, so wait for each to show up.
        const req = await vi.waitFor(() => {
          const [r] = http.match(`/assets/plans/${id}.json`);
          if (!r) throw new Error(`no request for ${id} yet`);
          return r;
        });
        if (id === 'easter') req.flush('nope', { status: 404, statusText: 'Not Found' });
        else req.flush(plan(id));
      }
      expect((await result).map(p => p.id)).toEqual(['first-steps', 'new-testament', 'christmas', 'valley-of-shadow']);
      http.verify();
      vi.restoreAllMocks();
    });
  });

  it('imports a plan from a URL with all progress reset', async () => {
    const remote = { ...plan('shared', [[true, true], [true]]), status: 'completed' as const };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(remote)));
    const imported = await service.importFromUrl('https://example.test/plan.json');
    expect(imported.status).toBe('not started');
    expect(service.progressScore(imported)).toBe(0);
    expect(imported.goals.every(g => !g.completed)).toBe(true);
    expect((await service.get('shared'))?.status).toBe('not started');
    vi.restoreAllMocks();
  });
});
