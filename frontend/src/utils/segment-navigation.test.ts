import { describe, it, expect } from 'vitest';
import type { Segment } from '../types/segment';
import {
  getNextSegmentId,
  getPreviousSegmentId,
  isSegmentReviewed,
} from './segment-navigation';

function seg(
  id: string,
  startTime: number,
  overrides: Partial<Segment> = {}
): Segment {
  return {
    segmentId: id,
    sessionId: 'session-1',
    startTime,
    endTime: startTime + 1,
    originalText: `text-${id}`,
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

const segments: Segment[] = [
  seg('a', 0),
  seg('b', 1),
  seg('c', 2),
  seg('d', 3),
];

describe('isSegmentReviewed', () => {
  it('treats CONFIRMED segments as reviewed', () => {
    expect(isSegmentReviewed(seg('x', 0, { consensusStatus: 'CONFIRMED' }))).toBe(
      true
    );
  });

  it('treats segments in correctedIds as reviewed', () => {
    expect(isSegmentReviewed(seg('x', 0), new Set(['x']))).toBe(true);
  });

  it('treats others as not reviewed', () => {
    expect(isSegmentReviewed(seg('x', 0), new Set(['y']))).toBe(false);
    expect(isSegmentReviewed(seg('x', 0))).toBe(false);
  });
});

describe('getNextSegmentId (全件移動)', () => {
  it('returns the first segment when currentId is null', () => {
    expect(getNextSegmentId(segments, null)).toBe('a');
  });

  it('advances to the next segment', () => {
    expect(getNextSegmentId(segments, 'a')).toBe('b');
    expect(getNextSegmentId(segments, 'c')).toBe('d');
  });

  it('stays on the last segment at the end', () => {
    expect(getNextSegmentId(segments, 'd')).toBe('d');
  });

  it('returns the first segment when currentId is unknown', () => {
    expect(getNextSegmentId(segments, 'zzz')).toBe('a');
  });

  it('returns null for an empty segment list', () => {
    expect(getNextSegmentId([], null)).toBeNull();
    expect(getNextSegmentId([], 'a')).toBeNull();
  });
});

describe('getPreviousSegmentId (全件移動)', () => {
  it('returns the last segment when currentId is null', () => {
    expect(getPreviousSegmentId(segments, null)).toBe('d');
  });

  it('moves to the previous segment', () => {
    expect(getPreviousSegmentId(segments, 'd')).toBe('c');
    expect(getPreviousSegmentId(segments, 'b')).toBe('a');
  });

  it('stays on the first segment at the start', () => {
    expect(getPreviousSegmentId(segments, 'a')).toBe('a');
  });

  it('returns the last segment when currentId is unknown', () => {
    expect(getPreviousSegmentId(segments, 'zzz')).toBe('d');
  });

  it('returns null for an empty segment list', () => {
    expect(getPreviousSegmentId([], null)).toBeNull();
  });
});

describe('getNextSegmentId (未校閲のみ移動)', () => {
  // a, c を修正済みにすると未校閲は b, d
  const correctedIds = new Set(['a', 'c']);
  const opts = { uncorrectedOnly: true, correctedIds };

  it('skips reviewed segments when advancing', () => {
    // currentId が校閲済み a → 未校閲先頭 b
    expect(getNextSegmentId(segments, 'a', opts)).toBe('b');
    // b の次の未校閲は d（c を飛ばす）
    expect(getNextSegmentId(segments, 'b', opts)).toBe('d');
  });

  it('skips CONFIRMED segments', () => {
    const segs = [
      seg('a', 0, { consensusStatus: 'CONFIRMED' }),
      seg('b', 1),
      seg('c', 2),
    ];
    expect(getNextSegmentId(segs, null, { uncorrectedOnly: true })).toBe('b');
  });

  it('stays on the last uncorrected segment at the end', () => {
    expect(getNextSegmentId(segments, 'd', opts)).toBe('d');
  });

  it('returns null when all segments are reviewed', () => {
    const allCorrected = new Set(['a', 'b', 'c', 'd']);
    expect(
      getNextSegmentId(segments, null, {
        uncorrectedOnly: true,
        correctedIds: allCorrected,
      })
    ).toBeNull();
  });
});

describe('getPreviousSegmentId (未校閲のみ移動)', () => {
  const correctedIds = new Set(['a', 'c']);
  const opts = { uncorrectedOnly: true, correctedIds };

  it('returns the last uncorrected segment when currentId is null', () => {
    expect(getPreviousSegmentId(segments, null, opts)).toBe('d');
  });

  it('skips reviewed segments when moving back', () => {
    expect(getPreviousSegmentId(segments, 'd', opts)).toBe('b');
    expect(getPreviousSegmentId(segments, 'b', opts)).toBe('b'); // b は未校閲先頭
  });
});
