import { describe, it, expect } from 'vitest';
import { sortSegmentsByTimestamp, formatTimestamp, parseTimestamp } from './segment-utils';
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
      makeSegment({ segmentId: 'a', startTime: 10.5 }),
      makeSegment({ segmentId: 'b', startTime: 0.1 }),
      makeSegment({ segmentId: 'c', startTime: 5.3 }),
    ];

    const sorted = sortSegmentsByTimestamp(segments);

    expect(sorted.map((s) => s.segmentId)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the original array', () => {
    const segments: Segment[] = [
      makeSegment({ segmentId: 'x', startTime: 9 }),
      makeSegment({ segmentId: 'y', startTime: 2 }),
    ];

    const copy = [...segments];
    sortSegmentsByTimestamp(segments);

    expect(segments).toEqual(copy);
  });

  it('handles empty array', () => {
    expect(sortSegmentsByTimestamp([])).toEqual([]);
  });

  it('handles single element array', () => {
    const segments = [makeSegment({ startTime: 42 })];
    const sorted = sortSegmentsByTimestamp(segments);
    expect(sorted).toEqual(segments);
  });

  it('handles segments with equal startTime preserving relative order', () => {
    const segments: Segment[] = [
      makeSegment({ segmentId: 'a', startTime: 5 }),
      makeSegment({ segmentId: 'b', startTime: 5 }),
    ];

    const sorted = sortSegmentsByTimestamp(segments);
    expect(sorted.map((s) => s.segmentId)).toEqual(['a', 'b']);
  });
});

describe('formatTimestamp', () => {
  it('formats 0 seconds as 00:00:00', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
  });

  it('formats seconds only', () => {
    expect(formatTimestamp(45)).toBe('00:00:45');
  });

  it('formats minutes and seconds', () => {
    expect(formatTimestamp(125)).toBe('00:02:05');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatTimestamp(3661)).toBe('01:01:01');
  });

  it('truncates decimal seconds', () => {
    expect(formatTimestamp(59.999)).toBe('00:00:59');
  });

  it('handles large hour values', () => {
    expect(formatTimestamp(86399)).toBe('23:59:59');
  });

  it('pads single-digit values with leading zeros', () => {
    expect(formatTimestamp(1)).toBe('00:00:01');
    expect(formatTimestamp(60)).toBe('00:01:00');
    expect(formatTimestamp(3600)).toBe('01:00:00');
  });
});

describe('parseTimestamp', () => {
  it('parses 00:00:00 as 0', () => {
    expect(parseTimestamp('00:00:00')).toBe(0);
  });

  it('parses hours correctly', () => {
    expect(parseTimestamp('02:00:00')).toBe(7200);
  });

  it('parses minutes correctly', () => {
    expect(parseTimestamp('00:30:00')).toBe(1800);
  });

  it('parses seconds correctly', () => {
    expect(parseTimestamp('00:00:45')).toBe(45);
  });

  it('parses combined HH:MM:SS correctly', () => {
    expect(parseTimestamp('01:02:03')).toBe(3723);
  });

  it('round-trips with formatTimestamp for integer seconds', () => {
    const testValues = [0, 1, 59, 60, 3599, 3600, 3661, 86399];
    for (const seconds of testValues) {
      expect(parseTimestamp(formatTimestamp(seconds))).toBe(seconds);
    }
  });
});
