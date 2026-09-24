// Run-control helpers shared by both importers (TV Time, WatchBuddy export):
// cancellation, retry of transient proxy failures, and a small worker pool.

export class ImportCancelled extends Error {
  constructor() {
    super('Import cancelled');
    this.name = 'ImportCancelled';
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ImportCancelled();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry transient proxy failures (cold starts, network blips). */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ImportCancelled || attempt >= 2) throw e;
      await sleep(delay);
      delay *= 3;
    }
  }
}

/** Run `fn` over `items` with a small worker pool, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** What an import screen shows after a failed run: nothing for a cancel. */
export function importErrorMessage(e: unknown): string | null {
  if (e instanceof ImportCancelled) return null;
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}
