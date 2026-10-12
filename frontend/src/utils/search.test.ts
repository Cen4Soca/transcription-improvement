import { describe, it, expect } from 'vitest';
import { searchSegments, filterUncorrectedSegments } from './search';
import type { Segment } from '../types/segment';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 1,
    originalText: 'hello world',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('searchSegments', () => {
  const segments: Segment[] = [
    makeSegment({ segmentId: 'a', originalText: 'Hello World' }),
    makeSegment({ segmentId: 'b', originalText: 'foo bar baz' }),
    makeSegment({ segmentId: 'c', originalText: 'HELLO again' }),
    makeSegment({ segmentId: 'd', originalText: 'nothing here' }),
  ];

  it('returns all segments when keyword is empty', () => {
    const result = searchSegments(segments, '');
    expect(result).toEqual(segments);
  });

  it('performs case-insensitive partial match', () => {
    const result = searchSegments(segments, 'hello');
    expect(result.map((s) => s.segmentId)).toEqual(['a', 'c']);
  });

  it('matches uppercase keyword against lowercase text', () => {
    const result = searchSegments(segments, 'FOO');
    expect(result.map((s) => s.segmentId)).toEqual(['b']);
  });

  it('returns empty array when no segments match', () => {
    const result = searchSegments(segments, 'xyz');
    expect(result).toEqual([]);
  });

  it('matches partial text within a segment', () => {
    const result = searchSegments(segments, 'orld');
    expect(result.map((s) => s.segmentId)).toEqual(['a']);
  });

  it('handles empty segments array', () => {
    const result = searchSegments([], 'hello');
    expect(result).toEqual([]);
  });

  it('matches Japanese text', () => {
    const jpSegments: Segment[] = [
      makeSegment({ segmentId: 'jp1', originalText: 'こんにちは世界' }),
      makeSegment({ segmentId: 'jp2', originalText: 'さようなら' }),
    ];
    const result = searchSegments(jpSegments, '世界');
    expect(result.map((s) => s.segmentId)).toEqual(['jp1']);
  });
});

describe('filterUncorrectedSegments', () => {
  const segments: Segment[] = [
    makeSegment({ segmentId: 'a' }),
    makeSegment({ segmentId: 'b' }),
    makeSegment({ segmentId: 'c' }),
    makeSegment({ segmentId: 'd' }),
  ];

  it('returns only segments without corrections', () => {
    const correctedIds = new Set(['a', 'c']);
    const result = filterUncorrectedSegments(segments, correctedIds);
    expect(result.map((s) => s.segmentId)).toEqual(['b', 'd']);
  });

  it('returns all segments when no corrections exist', () => {
    const correctedIds = new Set<string>();
    const result = filterUncorrectedSegments(segments, correctedIds);
    expect(result).toEqual(segments);
  });

  it('returns empty array when all segments are corrected', () => {
    const correctedIds = new Set(['a', 'b', 'c', 'd']);
    const result = filterUncorrectedSegments(segments, correctedIds);
    expect(result).toEqual([]);
  });

  it('handles empty segments array', () => {
    const correctedIds = new Set(['a']);
    const result = filterUncorrectedSegments([], correctedIds);
    expect(result).toEqual([]);
  });
});
