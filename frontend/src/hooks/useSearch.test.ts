import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearch } from './useSearch';
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

describe('useSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const segments: Segment[] = [
    makeSegment({ segmentId: 'a', originalText: 'Hello World' }),
    makeSegment({ segmentId: 'b', originalText: 'foo bar baz' }),
    makeSegment({ segmentId: 'c', originalText: 'HELLO again' }),
    makeSegment({ segmentId: 'd', originalText: 'nothing here' }),
  ];

  it('returns all segments when keyword is empty', () => {
    const { result } = renderHook(() =>
      useSearch(segments, new Set<string>())
    );

    expect(result.current.results).toEqual(segments);
    expect(result.current.matchCount).toBe(segments.length);
  });

  it('debounces keyword changes by 300ms', () => {
    const { result } = renderHook(() =>
      useSearch(segments, new Set<string>())
    );

    act(() => {
      result.current.setKeyword('hello');
    });

    // Before debounce fires, results should still be all segments
    expect(result.current.isSearching).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // After 300ms, search should execute
    expect(result.current.isSearching).toBe(false);
    expect(result.current.results.map((s) => s.segmentId)).toEqual(['a', 'c']);
  });

  it('performs case-insensitive partial match after debounce', () => {
    const { result } = renderHook(() =>
      useSearch(segments, new Set<string>())
    );

    act(() => {
      result.current.setKeyword('FOO');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results.map((s) => s.segmentId)).toEqual(['b']);
  });

  it('shows matchCount as 0 when no segments match (0件一致)', () => {
    const { result } = renderHook(() =>
      useSearch(segments, new Set<string>())
    );

    act(() => {
      result.current.setKeyword('xyz');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.matchCount).toBe(0);
    expect(result.current.results).toEqual([]);
  });

  it('filters uncorrected segments when showUncorrectedOnly is true', () => {
    const correctedIds = new Set(['a', 'c']);
    const { result } = renderHook(() =>
      useSearch(segments, correctedIds)
    );

    act(() => {
      result.current.setShowUncorrectedOnly(true);
    });

    // With no keyword, should show only uncorrected segments
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results.map((s) => s.segmentId)).toEqual(['b', 'd']);
  });

  it('combines uncorrected filter with keyword search', () => {
    const correctedIds = new Set(['a']);
    const { result } = renderHook(() =>
      useSearch(segments, correctedIds)
    );

    act(() => {
      result.current.setShowUncorrectedOnly(true);
      result.current.setKeyword('hello');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // 'a' is corrected so excluded, 'c' has 'HELLO' and is uncorrected
    expect(result.current.results.map((s) => s.segmentId)).toEqual(['c']);
  });

  it('resets search results when keyword is cleared', () => {
    const { result } = renderHook(() =>
      useSearch(segments, new Set<string>())
    );

    act(() => {
      result.current.setKeyword('hello');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results).toHaveLength(2);

    act(() => {
      result.current.setKeyword('');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results).toEqual(segments);
    expect(result.current.matchCount).toBe(segments.length);
  });

  it('cancels previous debounce timer on rapid keyword changes', () => {
    const { result } = renderHook(() =>
      useSearch(segments, new Set<string>())
    );

    act(() => {
      result.current.setKeyword('hel');
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current.setKeyword('foo');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Should only search for 'foo', not 'hel'
    expect(result.current.results.map((s) => s.segmentId)).toEqual(['b']);
  });
});
