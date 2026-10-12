import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMediaSync } from './useMediaSync';
import type { Segment } from '../types/segment';

function createSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 5,
    originalText: 'テスト',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('useMediaSync', () => {
  const segments: Segment[] = [
    createSegment({ segmentId: 'seg-1', startTime: 0, endTime: 5 }),
    createSegment({ segmentId: 'seg-2', startTime: 5, endTime: 10 }),
    createSegment({ segmentId: 'seg-3', startTime: 10, endTime: 15 }),
    createSegment({ segmentId: 'seg-4', startTime: 15, endTime: 20 }),
  ];

  beforeEach(() => {
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    expect(result.current.currentTime).toBe(0);
    expect(result.current.highlightedSegmentId).toBeNull();
    expect(result.current.seekTo).toBeNull();
  });

  it('should highlight the correct segment based on playback time', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    act(() => {
      result.current.handleTimeUpdate(3);
    });

    expect(result.current.currentTime).toBe(3);
    expect(result.current.highlightedSegmentId).toBe('seg-1');
  });

  it('should update highlighted segment when time crosses segment boundary', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    act(() => {
      result.current.handleTimeUpdate(3);
    });
    expect(result.current.highlightedSegmentId).toBe('seg-1');

    act(() => {
      result.current.handleTimeUpdate(7);
    });
    expect(result.current.highlightedSegmentId).toBe('seg-2');

    act(() => {
      result.current.handleTimeUpdate(12);
    });
    expect(result.current.highlightedSegmentId).toBe('seg-3');
  });

  it('should set seekTo when a segment is clicked', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    act(() => {
      result.current.handleSegmentClick('seg-3');
    });

    // seekTo should be set to the segment's startTime
    expect(result.current.seekTo).toBe(10);
  });

  it('should not change seekTo for non-existent segment', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    act(() => {
      result.current.handleSegmentClick('non-existent');
    });

    expect(result.current.seekTo).toBeNull();
  });

  it('should return null highlightedSegmentId for empty segments', () => {
    const { result } = renderHook(() => useMediaSync([]));

    act(() => {
      result.current.handleTimeUpdate(5);
    });

    expect(result.current.highlightedSegmentId).toBeNull();
  });

  it('should highlight last segment when time is past all segments', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    act(() => {
      result.current.handleTimeUpdate(25);
    });

    expect(result.current.highlightedSegmentId).toBe('seg-4');
  });

  it('should highlight segment at exact start time boundary', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    act(() => {
      result.current.handleTimeUpdate(10);
    });

    expect(result.current.highlightedSegmentId).toBe('seg-3');
  });

  it('should not change highlightedSegmentId if time stays within same segment', () => {
    const { result } = renderHook(() => useMediaSync(segments));

    act(() => {
      result.current.handleTimeUpdate(1);
    });
    expect(result.current.highlightedSegmentId).toBe('seg-1');

    act(() => {
      result.current.handleTimeUpdate(2);
    });
    expect(result.current.highlightedSegmentId).toBe('seg-1');

    act(() => {
      result.current.handleTimeUpdate(4);
    });
    expect(result.current.highlightedSegmentId).toBe('seg-1');
  });

  describe('auto-scroll pause during editing (Requirement 4.10)', () => {
    it('should not auto-scroll when isEditing is true', () => {
      // Create a DOM element to simulate the segment being off-screen
      const container = document.createElement('div');
      container.setAttribute('data-scroll-container', '');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200 }),
      });
      const segmentEl = document.createElement('div');
      segmentEl.setAttribute('data-segment-id', 'seg-3');
      Object.defineProperty(segmentEl, 'getBoundingClientRect', {
        value: () => ({ top: 300, bottom: 330, left: 0, right: 800, width: 800, height: 30 }),
      });
      segmentEl.scrollIntoView = vi.fn();
      container.appendChild(segmentEl);
      document.body.appendChild(container);

      const { result } = renderHook(() =>
        useMediaSync(segments, { isEditing: true })
      );

      act(() => {
        result.current.handleTimeUpdate(12);
      });

      // Highlight should still update
      expect(result.current.highlightedSegmentId).toBe('seg-3');
      // But scrollIntoView should NOT be called because isEditing is true
      expect(segmentEl.scrollIntoView).not.toHaveBeenCalled();

      document.body.removeChild(container);
    });

    it('should auto-scroll when isEditing is false and segment is off-screen', () => {
      const container = document.createElement('div');
      container.setAttribute('data-scroll-container', '');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200 }),
      });
      const segmentEl = document.createElement('div');
      segmentEl.setAttribute('data-segment-id', 'seg-3');
      Object.defineProperty(segmentEl, 'getBoundingClientRect', {
        value: () => ({ top: 300, bottom: 330, left: 0, right: 800, width: 800, height: 30 }),
      });
      segmentEl.scrollIntoView = vi.fn();
      container.appendChild(segmentEl);
      document.body.appendChild(container);

      const { result } = renderHook(() =>
        useMediaSync(segments, { isEditing: false })
      );

      act(() => {
        result.current.handleTimeUpdate(12);
      });

      expect(result.current.highlightedSegmentId).toBe('seg-3');
      expect(segmentEl.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      });

      document.body.removeChild(container);
    });

    it('should resume auto-scroll when editing ends', () => {
      const container = document.createElement('div');
      container.setAttribute('data-scroll-container', '');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200 }),
      });
      const segmentEl = document.createElement('div');
      segmentEl.setAttribute('data-segment-id', 'seg-3');
      Object.defineProperty(segmentEl, 'getBoundingClientRect', {
        value: () => ({ top: 300, bottom: 330, left: 0, right: 800, width: 800, height: 30 }),
      });
      segmentEl.scrollIntoView = vi.fn();
      container.appendChild(segmentEl);
      document.body.appendChild(container);

      const { result, rerender } = renderHook(
        ({ editing }) => useMediaSync(segments, { isEditing: editing }),
        { initialProps: { editing: true } }
      );

      // Move to seg-3 while editing
      act(() => {
        result.current.handleTimeUpdate(12);
      });
      expect(segmentEl.scrollIntoView).not.toHaveBeenCalled();

      // Stop editing - should trigger auto-scroll
      rerender({ editing: false });

      expect(segmentEl.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      });

      document.body.removeChild(container);
    });
  });
});
