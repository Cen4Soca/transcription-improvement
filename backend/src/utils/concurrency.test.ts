import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves input order', async () => {
    const result = await mapWithConcurrency([30, 10, 20], async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(result).toEqual([0, 1, 2]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
      3
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], async () => 1)).toEqual([]);
  });

  it('propagates the first rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });
});
