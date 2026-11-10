import { PlanStatsService } from './plan-stats.service';

describe('PlanStatsService', () => {
  let service: PlanStatsService;
  let fetchMock: ReturnType<typeof vi.fn>;
  const posted = () => fetchMock.mock.calls.filter(c => c[1]?.method === 'POST').map(c => JSON.parse(c[1].body));

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stats: { p1: { starts: 2, completions: 1, listens: 7 } } }) });
    vi.stubGlobal('fetch', fetchMock);
    service = new PlanStatsService();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends only the plan id and the event', () => {
    service.countListen('p1');
    service.countComplete('p1');
    expect(posted()).toEqual([{ planId: 'p1', event: 'listen' }, { planId: 'p1', event: 'complete' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/plan-stats');
  });

  it('counts a start once per device and plan, even across reloads', () => {
    service.countStart('p1');
    service.countStart('p1');
    new PlanStatsService().countStart('p1'); // "after a reload"
    service.countStart('p2');
    expect(posted()).toEqual([{ planId: 'p1', event: 'start' }, { planId: 'p2', event: 'start' }]);
  });

  it('returns the stats map', async () => {
    expect(await service.fetchAll()).toEqual({ p1: { starts: 2, completions: 1, listens: 7 } });
  });

  it('returns null instead of throwing when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await service.fetchAll()).toBeNull();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await service.fetchAll()).toBeNull();
  });

  it('never throws when a counter cannot be sent', () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => service.countListen('p1')).not.toThrow();
  });
});
