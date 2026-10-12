import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeConsensus, shouldTriggerPartialAggregation, getProgressInfo } from './consensus-service.js';

describe('Feature: transcription-review-app, Property 15: Consensus集計とConsensusResult自動確定', () => {
  /**
   * **Validates: Requirements 10.3, 10.4**
   *
   * When the most common answer's rate >= threshold, computeConsensus returns CONFIRMED with that text.
   */
  it('returns CONFIRMED with consensus text when agreement rate >= threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }), // threshold
        fc.integer({ min: 1, max: 50 }),   // totalReviewers
        fc.string({ minLength: 1, maxLength: 50 }), // consensus text
        (threshold, totalReviewers, consensusText) => {
          // Calculate the minimum count needed to meet the threshold
          const minCount = Math.ceil((threshold * totalReviewers) / 100);
          // Ensure minCount does not exceed totalReviewers
          const count = Math.min(minCount, totalReviewers);

          // Verify that this count actually meets the threshold
          const rate = (count / totalReviewers) * 100;
          if (rate < threshold) return; // skip edge cases where rounding prevents meeting threshold

          // Build corrections where `count` reviewers give the same answer
          const corrections = Array.from({ length: count }, (_, i) => ({
            userId: `user-${i}`,
            afterText: consensusText,
          }));

          const result = computeConsensus({
            corrections,
            threshold,
            totalReviewers,
          });

          expect(result.status).toBe('CONFIRMED');
          expect(result.consensusText).toBe(consensusText);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.3, 10.4**
   *
   * When no answer's rate >= threshold, computeConsensus returns CONFLICT.
   */
  it('returns CONFLICT when no answer rate meets the threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),  // threshold (at least 2% so we can construct a failing case)
        fc.integer({ min: 2, max: 50 }),   // totalReviewers (at least 2 to have distinct answers)
        (threshold, totalReviewers) => {
          // Each reviewer gives a unique answer so max count is 1
          // Agreement rate = (1 / totalReviewers) * 100
          // We need this to be < threshold
          const maxPossibleRate = (1 / totalReviewers) * 100;
          if (maxPossibleRate >= threshold) return; // skip cases where single answer meets threshold

          const corrections = Array.from({ length: totalReviewers }, (_, i) => ({
            userId: `user-${i}`,
            afterText: `unique-answer-${i}`,
          }));

          const result = computeConsensus({
            corrections,
            threshold,
            totalReviewers,
          });

          expect(result.status).toBe('CONFLICT');
          expect(result.consensusText).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.3, 10.4**
   *
   * The agreement rate is always calculated as (maxCount / totalReviewers) * 100.
   */
  it('agreement rate equals (maxCount / totalReviewers) * 100', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),  // threshold
        fc.integer({ min: 1, max: 50 }),   // totalReviewers
        fc.array(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 10 }),
            afterText: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd'), { minLength: 1, maxLength: 5 }),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (threshold, totalReviewers, corrections) => {
          const result = computeConsensus({
            corrections,
            threshold,
            totalReviewers,
          });

          // Calculate expected max count
          const counts = new Map<string, number>();
          for (const c of corrections) {
            counts.set(c.afterText, (counts.get(c.afterText) ?? 0) + 1);
          }
          let maxCount = 0;
          for (const count of counts.values()) {
            if (count > maxCount) maxCount = count;
          }

          const expectedRate = (maxCount / totalReviewers) * 100;
          expect(result.agreementRate).toBeCloseTo(expectedRate, 10);
          expect(result.agreementCount).toBe(maxCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.3, 10.4**
   *
   * The consensus text is always the most common answer when CONFIRMED.
   */
  it('consensus text is the most common answer when status is CONFIRMED', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),  // threshold
        fc.integer({ min: 1, max: 20 }),   // totalReviewers
        fc.array(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 10 }),
            afterText: fc.constantFrom('alpha', 'beta', 'gamma'),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (threshold, totalReviewers, corrections) => {
          if (corrections.length === 0) return;

          const result = computeConsensus({
            corrections,
            threshold,
            totalReviewers,
          });

          if (result.status === 'CONFIRMED') {
            // Find the most common answer
            const counts = new Map<string, number>();
            for (const c of corrections) {
              counts.set(c.afterText, (counts.get(c.afterText) ?? 0) + 1);
            }
            let maxCount = 0;
            let mostCommon = '';
            for (const [text, count] of counts) {
              if (count > maxCount) {
                maxCount = count;
                mostCommon = text;
              }
            }

            expect(result.consensusText).toBe(mostCommon);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: transcription-review-app, Property 38: 部分集計トリガー条件', () => {
  /**
   * **Validates: Requirements 10.3**
   *
   * When partialAggregationEnabled is false, shouldTriggerPartialAggregation
   * always returns false regardless of completedCount and totalReviewers.
   */
  it('returns false when partialAggregationEnabled is false', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (completedCount, totalReviewers) => {
          const result = shouldTriggerPartialAggregation({
            completedCount,
            totalReviewers,
            partialAggregationEnabled: false,
          });
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * When partialAggregationEnabled is true AND completedCount >= ceil(totalReviewers/2)
   * AND completedCount < totalReviewers, returns true (partial aggregation triggers).
   */
  it('returns true when enabled, majority reached, and not all completed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        (totalReviewers) => {
          const majorityThreshold = Math.ceil(totalReviewers / 2);
          // Generate completedCount in [majorityThreshold, totalReviewers - 1]
          const completedCount = fc.sample(
            fc.integer({ min: majorityThreshold, max: totalReviewers - 1 }),
            1
          )[0];

          const result = shouldTriggerPartialAggregation({
            completedCount,
            totalReviewers,
            partialAggregationEnabled: true,
          });
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * When completedCount < ceil(totalReviewers/2), returns false
   * regardless of partialAggregationEnabled setting.
   */
  it('returns false when completedCount is below majority threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        (totalReviewers) => {
          const majorityThreshold = Math.ceil(totalReviewers / 2);
          // Generate completedCount in [0, majorityThreshold - 1]
          const completedCount = fc.sample(
            fc.integer({ min: 0, max: majorityThreshold - 1 }),
            1
          )[0];

          const result = shouldTriggerPartialAggregation({
            completedCount,
            totalReviewers,
            partialAggregationEnabled: true,
          });
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * When completedCount >= totalReviewers (all completed), returns false
   * because that is the full aggregation case, not partial.
   */
  it('returns false when all reviewers have completed (full aggregation case)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 50 }),
        (totalReviewers, extra) => {
          // completedCount >= totalReviewers
          const completedCount = totalReviewers + extra;

          const result = shouldTriggerPartialAggregation({
            completedCount,
            totalReviewers,
            partialAggregationEnabled: true,
          });
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: transcription-review-app, Property 48: 匿名化進捗情報の表示制御', () => {
  /**
   * **Validates: Requirements 10.11**
   *
   * When totalReviewers >= 5, getProgressInfo returns a message containing
   * the specific remaining count ("あと{remaining}人が回答待ち").
   */
  it('returns specific remaining count message when totalReviewers >= 5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (totalReviewers, completedCount) => {
          const clamped = Math.min(completedCount, totalReviewers);
          const result = getProgressInfo(clamped, totalReviewers);
          const expectedRemaining = totalReviewers - clamped;

          expect(result.message).toBe(`あと${expectedRemaining}人が回答待ち`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.11**
   *
   * When totalReviewers < 5, getProgressInfo returns the generic message
   * "まだ回答が集まっています" without revealing specific counts.
   */
  it('returns generic message when totalReviewers < 5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (totalReviewers, completedCount) => {
          const clamped = Math.min(completedCount, totalReviewers);
          const result = getProgressInfo(clamped, totalReviewers);

          expect(result.message).toBe('まだ回答が集まっています');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.11**
   *
   * The remaining count is always totalReviewers - completedCount when shown
   * (i.e., when totalReviewers >= 5).
   */
  it('remainingCount equals totalReviewers - completedCount when totalReviewers >= 5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (totalReviewers, completedCount) => {
          const clamped = Math.min(completedCount, totalReviewers);
          const result = getProgressInfo(clamped, totalReviewers);

          expect(result.remainingCount).toBe(totalReviewers - clamped);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.11**
   *
   * The remainingCount field is undefined when totalReviewers < 5
   * to prevent individual identification in small reviewer pools.
   */
  it('remainingCount is undefined when totalReviewers < 5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (totalReviewers, completedCount) => {
          const clamped = Math.min(completedCount, totalReviewers);
          const result = getProgressInfo(clamped, totalReviewers);

          expect(result.remainingCount).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
