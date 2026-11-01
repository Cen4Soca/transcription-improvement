import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Segment, ConsensusStatus } from '../types/segment';
import {
  getNextSegmentId,
  getPreviousSegmentId,
  isSegmentReviewed,
} from './segment-navigation';

/**
 * Feature: segment-navigation, Property-based tests.
 *
 * **Validates: 校閲効率化（キーボードカーソル移動）**
 * ReviewPage の Tab/Shift+Tab 移動が常に有効な segmentId（または null）へ
 * 遷移し、未校閲のみモードで校閲済みを選ばないことを保証する。
 */

const consensusArb: fc.Arbitrary<ConsensusStatus> = fc.constantFrom(
  'UNDECIDED',
  'CONFIRMED',
  'CONFLICT'
);

/** 一意な segmentId を持つソート済みセグメント配列を生成する。 */
const segmentsArb: fc.Arbitrary<Segment[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
    minLength: 0,
    maxLength: 12,
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

function correctedIdsArb(segments: Segment[]): fc.Arbitrary<Set<string>> {
  if (segments.length === 0) {
    return fc.constant(new Set<string>());
  }
  return fc
    .subarray(segments.map((s) => s.segmentId))
    .map((ids) => new Set(ids));
}

describe('Feature: segment-navigation, Property 1: 返り値は常に配列内の要素か null', () => {
  /**
   * **Validates: キーボードカーソル移動の健全性**
   * getNext/getPrevious の返り値は、入力セグメントの segmentId のいずれか、
   * もしくは null（移動対象が空）でなければならない。
   */
  it('next/previous return an existing segmentId or null', () => {
    fc.assert(
      fc.property(
        segmentsArb,
        fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
        fc.boolean(),
        (segments, currentId, uncorrectedOnly) => {
          const validIds = new Set(segments.map((s) => s.segmentId));

          const next = getNextSegmentId(segments, currentId, { uncorrectedOnly });
          const prev = getPreviousSegmentId(segments, currentId, {
            uncorrectedOnly,
          });

          for (const result of [next, prev]) {
            if (result !== null) {
              expect(validIds.has(result)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: segment-navigation, Property 2: 未校閲のみモードは校閲済みを返さない', () => {
  /**
   * **Validates: 「未校閲のみ移動」トグルの正しさ**
   * uncorrectedOnly=true のとき、返り値は校閲済み（CONFIRMED か correctedIds）
   * であってはならない。
   */
  it('never returns a reviewed segment in uncorrected-only mode', () => {
    fc.assert(
      fc.property(
        segmentsArb.chain((segments) =>
          fc.record({
            segments: fc.constant(segments),
            correctedIds: correctedIdsArb(segments),
            currentId: fc.option(
              segments.length > 0
                ? fc.constantFrom(...segments.map((s) => s.segmentId))
                : fc.string({ minLength: 1 }),
              { nil: null }
            ),
          })
        ),
        ({ segments, correctedIds, currentId }) => {
          const opts = { uncorrectedOnly: true, correctedIds };
          const next = getNextSegmentId(segments, currentId, opts);
          const prev = getPreviousSegmentId(segments, currentId, opts);

          for (const result of [next, prev]) {
            if (result !== null) {
              const target = segments.find((s) => s.segmentId === result)!;
              expect(isSegmentReviewed(target, correctedIds)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: segment-navigation, Property 3: 位置は単調（逆行しない）', () => {
  /**
   * **Validates: 移動の方向性**
   * 全件移動で next は現在位置以降、previous は現在位置以前のインデックスへ移る。
   */
  it('next does not move backward and previous does not move forward (full mode)', () => {
    fc.assert(
      fc.property(
        segmentsArb.filter((s) => s.length > 0).chain((segments) =>
          fc.record({
            segments: fc.constant(segments),
            currentId: fc.constantFrom(...segments.map((s) => s.segmentId)),
          })
        ),
        ({ segments, currentId }) => {
          const indexOf = (id: string | null) =>
            segments.findIndex((s) => s.segmentId === id);
          const current = indexOf(currentId);

          const next = getNextSegmentId(segments, currentId);
          const prev = getPreviousSegmentId(segments, currentId);

          expect(indexOf(next)).toBeGreaterThanOrEqual(current);
          expect(indexOf(prev)).toBeLessThanOrEqual(current);
        }
      ),
      { numRuns: 100 }
    );
  });
});
