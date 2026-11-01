import { runWithConcurrency } from './concurrency.util';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async n => { seen.push(n); });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never has more than `limit` workers in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBe(3);
  });

  it('starts the next item as soon as any worker frees up', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const run = runWithConcurrency([0, 1, 2], 2, async i => {
      started.push(i);
      await gates[i].promise;
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    gates[2].resolve();
    await run;
  });

  it('resolves immediately for an empty list', async () => {
    const worker = vi.fn();
    await runWithConcurrency([], 3, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});
