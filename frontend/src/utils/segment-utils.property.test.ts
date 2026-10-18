import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sortSegmentsByTimestamp } from './segments';
import type { Segment } from '../types/segment';

/**
 * Arbitrary for generating a Segment with random startTime values.
 */
const segmentArbitrary = fc.record({
  segmentId: fc.uuid(),
  sessionId: fc.uuid(),
  startTime: fc.float({ min: 0, max: 86400, noNaN: true }),
  endTime: fc.float({ min: 0, max: 86400, noNaN: true }),
  originalText: fc.string({ minLength: 1, maxLength: 100 }),
  speakerLabel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  consensusStatus: fc.constantFrom('UNDECIDED' as const, 'CONFIRMED' as const, 'CONFLICT' as const),
  consensusText: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
}) as fc.Arbitrary<Segment>;

describe('Feature: segment-display, Property 1: Segmentのタイムスタンプ順表示', () => {
  /**
   * **Validates: Requirements 1.1**
   * For any array of Segments with arbitrary startTime values,
   * sortSegmentsByTimestamp always returns them in ascending startTime order.
   */
  it('sortSegmentsByTimestamp always returns segments in ascending startTime order', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArbitrary, { minLength: 0, maxLength: 50 }),
        (segments) => {
          const sorted = sortSegmentsByTimestamp(segments);

          // Result length must equal input length
          expect(sorted).toHaveLength(segments.length);

          // Each consecutive pair must be in ascending startTime order
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].startTime).toBeGreaterThanOrEqual(sorted[i - 1].startTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
