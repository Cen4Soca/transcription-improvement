import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Segment, ConsensusStatus } from '../types/segment';
import { computeReviewProgress } from './review-progress';

function seg(
  id: string,
  overrides: Partial<Segment> = {}
): Segment {
  return {
    segmentId: id,
    sessionId: 'session-1',
    startTime: 0,
    endTime: 1,
    originalText: `text-${id}`,
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('computeReviewProgress', () => {
  it('returns zero progress for an empty list', () => {
    expect(computeReviewProgress([])).toEqual({ total: 0, done: 0, ratio: 0 });
  });

  it('counts corrected segments', () => {
    const segments = [seg('a'), seg('b'), seg('c'), seg('d')];
    const result = computeReviewProgress(segments, new Set(['a', 'b']));
    expect(result).toEqual({ total: 4, done: 2, ratio: 0.5 });
  });

  it('counts CONFIRMED segments as done', () => {
    const segments = [
      seg('a', { consensusStatus: 'CONFIRMED' }),
      seg('b'),
    ];
    const result = computeReviewProgress(segments);
    expect(result).toEqual({ total: 2, done: 1, ratio: 0.5 });
  });

  it('does not double-count a segment that is both corrected and CONFIRMED', () => {
    const segments = [seg('a', { consensusStatus: 'CONFIRMED' }), seg('b')];
    const result = computeReviewProgress(segments, new Set(['a']));
    expect(result.done).toBe(1);
    expect(result.ratio).toBe(0.5);
  });

  it('reports full progress when all segments are reviewed', () => {
    const segments = [seg('a'), seg('b')];
    const result = computeReviewProgress(segments, new Set(['a', 'b']));
    expect(result).toEqual({ total: 2, done: 2, ratio: 1 });
  });
});

const consensusArb: fc.Arbitrary<ConsensusStatus> = fc.constantFrom(
  'UNDECIDED',
  'CONFIRMED',
  'CONFLICT'
);

const segmentsArb: fc.Arbitrary<Segment[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
    minLength: 0,
    maxLength: 15,
  })
  .chain((ids) =>
    fc
      .tuple(...ids.map(() => consensusArb))
      .map((statuses) =>
        ids.map((id, i) => ({
          segmentId: id,
          sessionId: 'session-1',
          startTime: i,
          endTime: i + 1,
          originalText: `text-${id}`,
          consensusStatus: statuses[i],
        }))
      )
  );

describe('Feature: review-progress, Property 1: ratio は 0〜1 かつ done<=total', () => {
  /**
   * **Validates: 進捗バー表示の健全性**
   * done は 0..total の範囲、ratio は done/total かつ 0〜1 に収まる。
   */
  it('keeps done within [0, total] and ratio within [0, 1]', () => {
    fc.assert(
      fc.property(
        segmentsArb.chain((segments) =>
          fc.record({
            segments: fc.constant(segments),
            correctedIds:
              segments.length > 0
                ? fc
                    .subarray(segments.map((s) => s.segmentId))
                    .map((ids) => new Set(ids))
                : fc.constant(new Set<string>()),
          })
        ),
        ({ segments, correctedIds }) => {
          const { total, done, ratio } = computeReviewProgress(
            segments,
            correctedIds
          );
          expect(total).toBe(segments.length);
          expect(done).toBeGreaterThanOrEqual(0);
          expect(done).toBeLessThanOrEqual(total);
          expect(ratio).toBeGreaterThanOrEqual(0);
          expect(ratio).toBeLessThanOrEqual(1);
          if (total > 0) {
            expect(ratio).toBeCloseTo(done / total, 10);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
