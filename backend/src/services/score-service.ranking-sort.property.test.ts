import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sortRanking } from './score-service.js';

describe('Feature: transcription-review-app, Property 17: ContributorRankingのソート順', () => {
  /**
   * **Validates: Requirements 12.3**
   *
   * For any array of ContributorScore entries, the sorted result has scores
   * in non-increasing order, and for entries with equal scores, answerCount
   * is in non-increasing order.
   */

  const contributorScoreEntry = fc.record({
    score: fc.double({ min: 0, max: 100000, noNaN: true }),
    answerCount: fc.nat({ max: 100000 }),
  });

  it('sorted result has scores in non-increasing order', () => {
    fc.assert(
      fc.property(
        fc.array(contributorScoreEntry, { minLength: 0, maxLength: 50 }),
        (entries) => {
          const sorted = sortRanking(entries);
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].score).toBeLessThanOrEqual(sorted[i - 1].score);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for entries with equal scores, answerCount is in non-increasing order', () => {
    fc.assert(
      fc.property(
        fc.array(contributorScoreEntry, { minLength: 0, maxLength: 50 }),
        (entries) => {
          const sorted = sortRanking(entries);
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].score === sorted[i - 1].score) {
              expect(sorted[i].answerCount).toBeLessThanOrEqual(sorted[i - 1].answerCount);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
