import { describe, it } from 'vitest';
import fc from 'fast-check';
import { isStalled } from './stalled-threshold.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-26T00:00:00.000Z');

describe('Feature: session-monitoring, Property 1: stalled threshold boundary', () => {
  /**
   * **Validates: stalled definition (activity N or more days before now)**
   * For any threshold N and any age in ms, isStalled is true iff age >= N days.
   */
  it('isStalled is true iff the age is at least N days', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 90 }),
        fc.integer({ min: 0, max: 200 * MS_PER_DAY }),
        (days, ageMs) => {
          const last = new Date(NOW.getTime() - ageMs).toISOString();
          return isStalled(last, NOW, days) === ageMs >= days * MS_PER_DAY;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: monotonicity of the threshold**
   * A larger threshold never flags a session that a smaller one does not.
   */
  it('is monotonic in the threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 89 }),
        fc.integer({ min: 0, max: 200 * MS_PER_DAY }),
        (days, ageMs) => {
          const last = new Date(NOW.getTime() - ageMs).toISOString();
          return !isStalled(last, NOW, days + 1) || isStalled(last, NOW, days);
        }
      ),
      { numRuns: 100 }
    );
  });
});
