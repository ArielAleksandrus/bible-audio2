/** Runs `worker` over `items` with at most `limit` calls in flight at once. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runNext));
}
