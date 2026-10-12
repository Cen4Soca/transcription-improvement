import { describe, it, expect } from 'vitest';
import { sortSegmentsByTimestamp, formatTimestamp, parseTimestamp } from './segments';
import type { Segment } from '../types/segment';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 1,
    originalText: 'hello',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('sortSegmentsByTimestamp', () => {
  it('returns segments sorted by startTime ascending', () => {
    const segments: Segment[] = [
      makeSegment({ segmentId: 'a', startTime: 5.0 }),
      makeSegment({ segmentId: 'b', startTime: 1.5 }),
      makeSegment({ segmentId: 'c', startTime: 3.2 }),
    ];

    const sorted = sortSegmentsByTimestamp(segments);

    expect(sorted.map((s) => s.segmentId)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const segments: Segment[] = [
      makeSegment({ segmentId: 'a', startTime: 5.0 }),
      makeSegment({ segmentId: 'b', startTime: 1.0 }),
    ];

    const original = [...segments];
    sortSegmentsByTimestamp(segments);

    expect(segments).toEqual(original);
  });

  it('returns empty array for empty input', () => {
    expect(sortSegmentsByTimestamp([])).toEqual([]);
  });
});

describe('formatTimestamp', () => {
  it('formats 0 seconds as 00:00:00', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
  });

  it('formats seconds correctly', () => {
    expect(formatTimestamp(3661)).toBe('01:01:01');
  });

  it('truncates fractional seconds', () => {
    expect(formatTimestamp(3661.999)).toBe('01:01:01');
  });

  it('handles large hour values', () => {
    expect(formatTimestamp(36000)).toBe('10:00:00');
  });
});

describe('parseTimestamp', () => {
  it('parses 00:00:00 as 0', () => {
    expect(parseTimestamp('00:00:00')).toBe(0);
  });

  it('parses HH:MM:SS correctly', () => {
    expect(parseTimestamp('01:01:01')).toBe(3661);
  });

  it('round-trips with formatTimestamp', () => {
    const seconds = 7384;
    expect(parseTimestamp(formatTimestamp(seconds))).toBe(seconds);
  });
});
