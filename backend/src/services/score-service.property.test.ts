import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScore } from './score-service.js';

describe('Feature: transcription-review-app, Property 16: ContributorScoreの計算式', () => {
  /**
   * **Validates: Requirements 12.2**
   *
   * For any answerCount (non-negative integer) and accuracyRate (0.0-100.0),
   * calculateScore returns answerCount × accuracyRate / 100.
   */
  it('calculateScore returns answerCount × accuracyRate / 100 for all valid inputs', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100000 }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (answerCount, accuracyRate) => {
          const result = calculateScore(answerCount, accuracyRate);
          const expected = (answerCount * accuracyRate) / 100;
          expect(result).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 100 }
    );
  });
});
