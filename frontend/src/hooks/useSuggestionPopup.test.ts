import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSuggestionPopup } from './useSuggestionPopup';

function createMockOptions(overrides = {}) {
  return {
    disableHoverAutoShow: false,
    fetchSuggestions: vi.fn().mockResolvedValue({
      suggestions: [
        { text: '候補1', source: '履歴' },
        { text: '候補2', source: 'Bedrock' },
      ],
      hasError: false,
    }),
    onSelect: vi.fn(),
    onEditMode: vi.fn(),
    ...overrides,
  };
}

describe('useSuggestionPopup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('500ms hover trigger (Req 8.1)', () => {
    it('does not show popup before 500ms', () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      act(() => {
        result.current.handleSegmentHoverStart('seg-1');
      });

      // Before 500ms, popup should not be visible
      expect(result.current.state.isVisible).toBe(false);
      expect(options.fetchSuggestions).not.toHaveBeenCalled();
    });

    it('shows popup after 500ms hover', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      act(() => {
        result.current.handleSegmentHoverStart('seg-1');
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(result.current.state.isVisible).toBe(true);
      expect(result.current.state.segmentId).toBe('seg-1');
      expect(options.fetchSuggestions).toHaveBeenCalledWith('seg-1');
    });

    it('cancels popup if hover ends before 500ms', () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      act(() => {
        result.current.handleSegmentHoverStart('seg-1');
      });

      act(() => {
        vi.advanceTimersByTime(300);
        result.current.handleSegmentHoverEnd();
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.state.isVisible).toBe(false);
      expect(options.fetchSuggestions).not.toHaveBeenCalled();
    });

  });

  describe('button click trigger (Req 8.2)', () => {
    it('shows popup immediately on button click', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      expect(result.current.state.isVisible).toBe(true);
      expect(result.current.state.segmentId).toBe('seg-1');
      expect(options.fetchSuggestions).toHaveBeenCalledWith('seg-1');
    });

    it('cancels pending hover timer on button click', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      act(() => {
        result.current.handleSegmentHoverStart('seg-1');
      });

      await act(async () => {
        result.current.handleButtonClick('seg-2');
      });

      expect(result.current.state.segmentId).toBe('seg-2');
      // Only one call for the button click segment
      expect(options.fetchSuggestions).toHaveBeenCalledTimes(1);
      expect(options.fetchSuggestions).toHaveBeenCalledWith('seg-2');
    });
  });

  describe('hover auto-show disabled (Req 8.10)', () => {
    it('does not show popup on hover when disableHoverAutoShow is true', () => {
      const options = createMockOptions({ disableHoverAutoShow: true });
      const { result } = renderHook(() => useSuggestionPopup(options));

      act(() => {
        result.current.handleSegmentHoverStart('seg-1');
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.state.isVisible).toBe(false);
      expect(options.fetchSuggestions).not.toHaveBeenCalled();
    });

    it('still shows popup on button click when disableHoverAutoShow is true', async () => {
      const options = createMockOptions({ disableHoverAutoShow: true });
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      expect(result.current.state.isVisible).toBe(true);
      expect(options.fetchSuggestions).toHaveBeenCalledWith('seg-1');
    });
  });

  describe('segment switching (Req 8.9)', () => {
    it('closes existing popup and opens new one when hovering different segment', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      // Open popup for seg-1
      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      expect(result.current.state.segmentId).toBe('seg-1');

      // Hover on seg-2 triggers new popup
      act(() => {
        result.current.handleSegmentHoverStart('seg-2');
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(result.current.state.segmentId).toBe('seg-2');
      expect(result.current.state.isVisible).toBe(true);
    });
  });

  describe('loading state', () => {
    it('sets isLoading to true while fetching', async () => {
      let resolvePromise: (value: unknown) => void;
      const fetchSuggestions = vi.fn().mockImplementation(
        () => new Promise((resolve) => { resolvePromise = resolve; })
      );
      const options = createMockOptions({ fetchSuggestions });
      const { result } = renderHook(() => useSuggestionPopup(options));

      act(() => {
        result.current.handleButtonClick('seg-1');
      });

      expect(result.current.state.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({ suggestions: [], hasError: false });
      });

      expect(result.current.state.isLoading).toBe(false);
    });

    it('sets hasError when fetch fails', async () => {
      const fetchSuggestions = vi.fn().mockRejectedValue(new Error('Network error'));
      const options = createMockOptions({ fetchSuggestions });
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      expect(result.current.state.hasError).toBe(true);
      expect(result.current.state.isLoading).toBe(false);
    });

    it('populates suggestions after successful fetch', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      expect(result.current.state.suggestions).toEqual([
        { text: '候補1', source: '履歴' },
        { text: '候補2', source: 'Bedrock' },
      ]);
    });
  });

  describe('close popup (Req 8.8)', () => {
    it('resets state when closePopup is called', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      expect(result.current.state.isVisible).toBe(true);

      act(() => {
        result.current.closePopup();
      });

      expect(result.current.state.isVisible).toBe(false);
      expect(result.current.state.segmentId).toBeNull();
      expect(result.current.state.suggestions).toEqual([]);
    });
  });

  describe('selection handling (Req 8.4)', () => {
    it('calls onSelect with segmentId and text', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      act(() => {
        result.current.handleSelect('候補1');
      });

      expect(options.onSelect).toHaveBeenCalledWith('seg-1', '候補1');
    });

    it('closes popup after selection', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      act(() => {
        result.current.handleSelect('候補1');
      });

      expect(result.current.state.isVisible).toBe(false);
    });
  });

  describe('edit mode (Req 8.6)', () => {
    it('calls onEditMode with segmentId', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      act(() => {
        result.current.handleEditMode();
      });

      expect(options.onEditMode).toHaveBeenCalledWith('seg-1');
    });

    it('closes popup after entering edit mode', async () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useSuggestionPopup(options));

      await act(async () => {
        result.current.handleButtonClick('seg-1');
      });

      act(() => {
        result.current.handleEditMode();
      });

      expect(result.current.state.isVisible).toBe(false);
    });
  });

  describe('stale response handling', () => {
    it('ignores response from previous segment when a new segment is opened', async () => {
      let resolveFirst: (value: unknown) => void;
      let callCount = 0;
      const fetchSuggestions = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve({
          suggestions: [{ text: 'seg-2 候補', source: '履歴' }],
          hasError: false,
        });
      });

      const options = createMockOptions({ fetchSuggestions });
      const { result } = renderHook(() => useSuggestionPopup(options));

      // Open popup for seg-1 (will be slow)
      act(() => {
        result.current.handleButtonClick('seg-1');
      });

      // Immediately open popup for seg-2 (will be fast)
      await act(async () => {
        result.current.handleButtonClick('seg-2');
      });

      // Now resolve the first (stale) response
      await act(async () => {
        resolveFirst!({
          suggestions: [{ text: 'seg-1 候補', source: '履歴' }],
          hasError: false,
        });
      });

      // Should show seg-2 suggestions, not seg-1
      expect(result.current.state.segmentId).toBe('seg-2');
      expect(result.current.state.suggestions).toEqual([
        { text: 'seg-2 候補', source: '履歴' },
      ]);
    });
  });
});
