import { describe, it, expect } from 'vitest';
import {
  computeConsensus,
  shouldTriggerPartialAggregation,
  getProgressInfo,
  forceAggregateSegments,
  MIN_REVIEWERS_FOR_AUTO_CONSENSUS,
  type ConsensusInput,
  type SegmentCorrectionGroup,
} from './consensus-service.js';

describe('consensus-service', () => {
  describe('computeConsensus', () => {
    it('should return CONFIRMED when all reviewers agree and threshold is met', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'correct text' },
          { userId: 'user-2', afterText: 'correct text' },
          { userId: 'user-3', afterText: 'correct text' },
        ],
        threshold: 66,
        totalReviewers: 3,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFIRMED');
      expect(result.consensusText).toBe('correct text');
      expect(result.agreementCount).toBe(3);
      expect(result.agreementRate).toBeCloseTo(100);
    });

    it('should return CONFIRMED when majority meets threshold', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'answer A' },
          { userId: 'user-2', afterText: 'answer A' },
          { userId: 'user-3', afterText: 'answer B' },
        ],
        threshold: 60,
        totalReviewers: 3,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFIRMED');
      expect(result.consensusText).toBe('answer A');
      expect(result.agreementCount).toBe(2);
      expect(result.agreementRate).toBeCloseTo(66.67, 1);
    });

    it('should return CONFLICT when no answer meets threshold', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'answer A' },
          { userId: 'user-2', afterText: 'answer B' },
          { userId: 'user-3', afterText: 'answer C' },
        ],
        threshold: 50,
        totalReviewers: 3,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFLICT');
      expect(result.consensusText).toBeUndefined();
      expect(result.agreementCount).toBe(1);
      expect(result.agreementRate).toBeCloseTo(33.33, 1);
    });

    it('should return CONFLICT when threshold is exactly not met', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'answer A' },
          { userId: 'user-2', afterText: 'answer A' },
          { userId: 'user-3', afterText: 'answer B' },
          { userId: 'user-4', afterText: 'answer B' },
        ],
        threshold: 51,
        totalReviewers: 4,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFLICT');
      expect(result.agreementCount).toBe(2);
      expect(result.agreementRate).toBe(50);
    });

    it('should return CONFIRMED when threshold is exactly met', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'answer A' },
          { userId: 'user-2', afterText: 'answer A' },
          { userId: 'user-3', afterText: 'answer B' },
          { userId: 'user-4', afterText: 'answer B' },
        ],
        threshold: 50,
        totalReviewers: 4,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFIRMED');
      expect(result.consensusText).toBe('answer A');
      expect(result.agreementCount).toBe(2);
      expect(result.agreementRate).toBe(50);
    });

    it('should handle single reviewer with threshold 100', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'only answer' },
        ],
        threshold: 100,
        totalReviewers: 1,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFIRMED');
      expect(result.consensusText).toBe('only answer');
      expect(result.agreementCount).toBe(1);
      expect(result.agreementRate).toBe(100);
    });

    it('should handle empty corrections array', () => {
      const input: ConsensusInput = {
        corrections: [],
        threshold: 50,
        totalReviewers: 3,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFLICT');
      expect(result.agreementCount).toBe(0);
      expect(result.agreementRate).toBe(0);
    });

    it('should handle empty string as afterText', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: '' },
          { userId: 'user-2', afterText: '' },
          { userId: 'user-3', afterText: 'some text' },
        ],
        threshold: 60,
        totalReviewers: 3,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFIRMED');
      expect(result.consensusText).toBe('');
      expect(result.agreementCount).toBe(2);
      expect(result.agreementRate).toBeCloseTo(66.67, 1);
    });

    it('should throw error when threshold is below 1', () => {
      const input: ConsensusInput = {
        corrections: [{ userId: 'user-1', afterText: 'text' }],
        threshold: 0,
        totalReviewers: 1,
      };

      expect(() => computeConsensus(input)).toThrow(
        'threshold は 1〜100 の範囲で指定してください。'
      );
    });

    it('should throw error when threshold is above 100', () => {
      const input: ConsensusInput = {
        corrections: [{ userId: 'user-1', afterText: 'text' }],
        threshold: 101,
        totalReviewers: 1,
      };

      expect(() => computeConsensus(input)).toThrow(
        'threshold は 1〜100 の範囲で指定してください。'
      );
    });

    it('should throw error when totalReviewers is less than 1', () => {
      const input: ConsensusInput = {
        corrections: [{ userId: 'user-1', afterText: 'text' }],
        threshold: 50,
        totalReviewers: 0,
      };

      expect(() => computeConsensus(input)).toThrow(
        'totalReviewers は 1 以上である必要があります。'
      );
    });

    it('should use totalReviewers for rate calculation, not corrections length', () => {
      // 2 out of 5 total reviewers agree — rate is 40%, not 100%
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'answer A' },
          { userId: 'user-2', afterText: 'answer A' },
        ],
        threshold: 50,
        totalReviewers: 5,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFLICT');
      expect(result.agreementRate).toBe(40);
    });

    it('should pick the first most common answer when there is a tie', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'answer A' },
          { userId: 'user-2', afterText: 'answer B' },
        ],
        threshold: 50,
        totalReviewers: 2,
      };

      const result = computeConsensus(input);

      // Both have count 1, first encountered wins
      expect(result.status).toBe('CONFIRMED');
      expect(result.agreementCount).toBe(1);
      expect(result.agreementRate).toBe(50);
    });

    it('should handle threshold of 1 (very low threshold)', () => {
      const input: ConsensusInput = {
        corrections: [
          { userId: 'user-1', afterText: 'answer A' },
          { userId: 'user-2', afterText: 'answer B' },
          { userId: 'user-3', afterText: 'answer C' },
          { userId: 'user-4', afterText: 'answer D' },
          { userId: 'user-5', afterText: 'answer E' },
        ],
        threshold: 1,
        totalReviewers: 5,
      };

      const result = computeConsensus(input);

      // 1/5 = 20% >= 1% threshold
      expect(result.status).toBe('CONFIRMED');
      expect(result.agreementCount).toBe(1);
      expect(result.agreementRate).toBe(20);
    });

    it('should handle large number of reviewers', () => {
      const corrections = Array.from({ length: 100 }, (_, i) => ({
        userId: `user-${i}`,
        afterText: i < 75 ? 'majority answer' : `minority-${i}`,
      }));

      const input: ConsensusInput = {
        corrections,
        threshold: 70,
        totalReviewers: 100,
      };

      const result = computeConsensus(input);

      expect(result.status).toBe('CONFIRMED');
      expect(result.consensusText).toBe('majority answer');
      expect(result.agreementCount).toBe(75);
      expect(result.agreementRate).toBe(75);
    });
  });

  describe('shouldTriggerPartialAggregation', () => {
    it('should return false when partialAggregationEnabled is false', () => {
      const result = shouldTriggerPartialAggregation({
        completedCount: 3,
        totalReviewers: 5,
        partialAggregationEnabled: false,
      });
      expect(result).toBe(false);
    });

    it('should return false when completedCount equals totalReviewers (full aggregation case)', () => {
      const result = shouldTriggerPartialAggregation({
        completedCount: 5,
        totalReviewers: 5,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(false);
    });

    it('should return true when majority threshold is met (ceil(N/2))', () => {
      // ceil(5/2) = 3, completedCount = 3
      const result = shouldTriggerPartialAggregation({
        completedCount: 3,
        totalReviewers: 5,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(true);
    });

    it('should return true when more than majority have completed', () => {
      // ceil(5/2) = 3, completedCount = 4
      const result = shouldTriggerPartialAggregation({
        completedCount: 4,
        totalReviewers: 5,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(true);
    });

    it('should return false when below majority threshold', () => {
      // ceil(5/2) = 3, completedCount = 2
      const result = shouldTriggerPartialAggregation({
        completedCount: 2,
        totalReviewers: 5,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(false);
    });

    it('should handle even number of reviewers (ceil(4/2) = 2)', () => {
      const result = shouldTriggerPartialAggregation({
        completedCount: 2,
        totalReviewers: 4,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(true);
    });

    it('should handle 1 reviewer (ceil(1/2) = 1, but all completed is excluded)', () => {
      // With 1 reviewer, completedCount=1 means all completed → false
      const result = shouldTriggerPartialAggregation({
        completedCount: 1,
        totalReviewers: 1,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(false);
    });

    it('should handle 2 reviewers (ceil(2/2) = 1)', () => {
      const result = shouldTriggerPartialAggregation({
        completedCount: 1,
        totalReviewers: 2,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(true);
    });

    it('should return false when totalReviewers is 0', () => {
      const result = shouldTriggerPartialAggregation({
        completedCount: 0,
        totalReviewers: 0,
        partialAggregationEnabled: true,
      });
      expect(result).toBe(false);
    });

    it('should handle 3 reviewers (ceil(3/2) = 2)', () => {
      expect(
        shouldTriggerPartialAggregation({
          completedCount: 1,
          totalReviewers: 3,
          partialAggregationEnabled: true,
        })
      ).toBe(false);

      expect(
        shouldTriggerPartialAggregation({
          completedCount: 2,
          totalReviewers: 3,
          partialAggregationEnabled: true,
        })
      ).toBe(true);
    });
  });

  describe('getProgressInfo', () => {
    it('should show specific count when totalReviewers >= 5', () => {
      const result = getProgressInfo(3, 5);
      expect(result.message).toBe('あと2人が回答待ち');
      expect(result.remainingCount).toBe(2);
    });

    it('should show generic message when totalReviewers < 5', () => {
      const result = getProgressInfo(2, 4);
      expect(result.message).toBe('まだ回答が集まっています');
      expect(result.remainingCount).toBeUndefined();
    });

    it('should show 0 remaining when all have completed (5+ reviewers)', () => {
      const result = getProgressInfo(5, 5);
      expect(result.message).toBe('あと0人が回答待ち');
      expect(result.remainingCount).toBe(0);
    });

    it('should show generic message for 3 reviewers with 1 completed', () => {
      const result = getProgressInfo(1, 3);
      expect(result.message).toBe('まだ回答が集まっています');
      expect(result.remainingCount).toBeUndefined();
    });

    it('should show specific count for exactly 5 reviewers', () => {
      const result = getProgressInfo(1, 5);
      expect(result.message).toBe('あと4人が回答待ち');
      expect(result.remainingCount).toBe(4);
    });

    it('should show specific count for large reviewer groups', () => {
      const result = getProgressInfo(7, 10);
      expect(result.message).toBe('あと3人が回答待ち');
      expect(result.remainingCount).toBe(3);
    });

    it('should show generic message for 1 reviewer', () => {
      const result = getProgressInfo(0, 1);
      expect(result.message).toBe('まだ回答が集まっています');
      expect(result.remainingCount).toBeUndefined();
    });
  });

  describe('forceAggregateSegments', () => {
    it('exposes a minimum-reviewer constant of 3', () => {
      expect(MIN_REVIEWERS_FOR_AUTO_CONSENSUS).toBe(3);
    });

    it('confirms a segment even with a single reviewer below the auto minimum', () => {
      const segments: SegmentCorrectionGroup[] = [
        {
          segmentId: 'seg-1',
          corrections: [{ userId: 'user-1', afterText: 'answer A' }],
        },
      ];

      // 1 reviewer, threshold 67: 1/1 = 100% >= 67% → CONFIRMED
      const results = forceAggregateSegments(segments, 67, 1);

      expect(results).toHaveLength(1);
      expect(results[0].segmentId).toBe('seg-1');
      expect(results[0].status).toBe('CONFIRMED');
      expect(results[0].consensusText).toBe('answer A');
      expect(results[0].agreementRate).toBe(100);
    });

    it('marks a segment as CONFLICT when the top answer misses the threshold', () => {
      const segments: SegmentCorrectionGroup[] = [
        {
          segmentId: 'seg-1',
          corrections: [
            { userId: 'user-1', afterText: 'answer A' },
            { userId: 'user-2', afterText: 'answer B' },
          ],
        },
      ];

      // 2 reviewers, threshold 67: top answer 1/2 = 50% < 67% → CONFLICT
      const results = forceAggregateSegments(segments, 67, 2);

      expect(results[0].status).toBe('CONFLICT');
      expect(results[0].consensusText).toBeUndefined();
      expect(results[0].agreementRate).toBe(50);
    });

    it('aggregates each segment independently', () => {
      const segments: SegmentCorrectionGroup[] = [
        {
          segmentId: 'seg-1',
          corrections: [
            { userId: 'u1', afterText: 'X' },
            { userId: 'u2', afterText: 'X' },
          ],
        },
        {
          segmentId: 'seg-2',
          corrections: [
            { userId: 'u1', afterText: 'Y' },
            { userId: 'u2', afterText: 'Z' },
          ],
        },
      ];

      const results = forceAggregateSegments(segments, 67, 2);

      expect(results.find((r) => r.segmentId === 'seg-1')?.status).toBe('CONFIRMED');
      expect(results.find((r) => r.segmentId === 'seg-2')?.status).toBe('CONFLICT');
    });

    it('treats a segment with no corrections as CONFLICT', () => {
      const segments: SegmentCorrectionGroup[] = [
        { segmentId: 'seg-empty', corrections: [] },
      ];

      const results = forceAggregateSegments(segments, 50, 2);

      expect(results[0].status).toBe('CONFLICT');
      expect(results[0].agreementCount).toBe(0);
    });

    it('does not throw when totalReviewers is 0 (guards to at least 1)', () => {
      const segments: SegmentCorrectionGroup[] = [
        { segmentId: 'seg-1', corrections: [{ userId: 'u1', afterText: 'A' }] },
      ];

      expect(() => forceAggregateSegments(segments, 50, 0)).not.toThrow();
      const results = forceAggregateSegments(segments, 50, 0);
      expect(results[0].status).toBe('CONFIRMED');
    });

    it('returns an empty array when there are no segments', () => {
      expect(forceAggregateSegments([], 67, 3)).toEqual([]);
    });
  });
});
