import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { useSessionTimeout } from './useSessionTimeout';

describe('Feature: session-timeout, Property 41: アイドルタイムアウト警告の表示タイミング', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Validates: Requirements 11.8**
   *
   * For any valid idle timeout T and warning threshold W (where W < T),
   * the warning should appear at exactly T - W milliseconds of inactivity,
   * and NOT before.
   */
  it('warning appears at exactly idleTimeout - warningBefore ms of inactivity', () => {
    fc.assert(
      fc.property(
        // Generate idleTimeoutMs: between 10s and 60s (scaled down for testing)
        fc.integer({ min: 10000, max: 60000 }),
        // Generate warningBeforeTimeoutMs: between 1s and idleTimeout - 1s
        fc.integer({ min: 1000, max: 59000 }),
        (idleTimeoutMs, warningBeforeTimeoutMsRaw) => {
          // Ensure warningBeforeTimeoutMs < idleTimeoutMs
          const warningBeforeTimeoutMs = Math.min(warningBeforeTimeoutMsRaw, idleTimeoutMs - 1000);
          if (warningBeforeTimeoutMs < 1000) return; // skip invalid combinations

          const warningDelay = idleTimeoutMs - warningBeforeTimeoutMs;
          const onTimeout = vi.fn();

          const { result, unmount } = renderHook(() =>
            useSessionTimeout({
              onTimeout,
              idleTimeoutMs,
              warningBeforeTimeoutMs,
              absoluteSessionMs: 24 * 60 * 60 * 1000, // large enough to not interfere
              enabled: true,
            })
          );

          // Initially, warning should NOT be shown
          expect(result.current.showWarning).toBe(false);

          // Advance to 1ms before warning should appear
          act(() => {
            vi.advanceTimersByTime(warningDelay - 1);
          });

          // Warning should NOT be shown yet
          expect(result.current.showWarning).toBe(false);

          // Advance 1 more ms to reach the exact warning time
          act(() => {
            vi.advanceTimersByTime(1);
          });

          // Warning SHOULD now be shown
          expect(result.current.showWarning).toBe(true);

          // onTimeout should NOT have been called yet
          expect(onTimeout).not.toHaveBeenCalled();

          // Clean up
          unmount();
          vi.clearAllTimers();
        }
      ),
      { numRuns: 100 }
    );
  });
});
