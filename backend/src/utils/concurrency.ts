/** Default number of in-flight DynamoDB queries used by monitoring fan-out. */
export const DEFAULT_CONCURRENCY = 10;

/**
 * Map `items` through an async function while keeping at most `limit` calls in
 * flight. Result order matches input order. The first rejection is propagated
 * (remaining workers stop picking up new items).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error: unknown) {
        failed = true;
        throw error;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
