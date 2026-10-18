import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionTimeout } from './useSessionTimeout';

describe('useSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not show warning initially', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
      })
    );

    expect(result.current.showWarning).toBe(false);
    expect(result.current.isAbsoluteExpired).toBe(false);
  });

  it('should show warning at idleTimeout - warningBefore (25 min mark)', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000, // 30 seconds for testing
        warningBeforeTimeoutMs: 5000, // 5 seconds before
      })
    );

    // Advance to warning time (25 seconds)
    act(() => {
      vi.advanceTimersByTime(25000);
    });

    expect(result.current.showWarning).toBe(true);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('should call onTimeout when idle timeout expires', () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
      })
    );

    // Advance past idle timeout
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('should reset idle timer when resetIdleTimer is called (Continue button)', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
      })
    );

    // Advance to warning time
    act(() => {
      vi.advanceTimersByTime(25000);
    });

    expect(result.current.showWarning).toBe(true);

    // User clicks "Continue"
    act(() => {
      result.current.resetIdleTimer();
    });

    expect(result.current.showWarning).toBe(false);

    // Should not timeout for another 30 seconds
    act(() => {
      vi.advanceTimersByTime(29000);
    });

    expect(onTimeout).not.toHaveBeenCalled();

    // Now it should timeout
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('should reset idle timer on user activity when warning is not showing', () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
      })
    );

    // Advance 20 seconds (before warning)
    act(() => {
      vi.advanceTimersByTime(20000);
    });

    // Simulate user activity
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
    });

    // Advance another 25 seconds (would have timed out without activity)
    act(() => {
      vi.advanceTimersByTime(25000);
    });

    // Should show warning now (25s after last activity)
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('should NOT reset idle timer on user activity when warning IS showing', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
      })
    );

    // Advance to warning time
    act(() => {
      vi.advanceTimersByTime(25000);
    });

    expect(result.current.showWarning).toBe(true);

    // Simulate user activity (should NOT reset timer when warning is showing)
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
    });

    // Warning should still be showing
    expect(result.current.showWarning).toBe(true);

    // Advance remaining 5 seconds - should timeout
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('should call onTimeout when absolute session expires (8 hours)', () => {
    const onTimeout = vi.fn();
    const loginTime = Date.now();

    renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
        absoluteSessionMs: 60000, // 60 seconds for testing
        loginTime,
      })
    );

    // Keep resetting idle timer to prevent idle timeout
    act(() => {
      vi.advanceTimersByTime(25000);
    });
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
    });
    act(() => {
      vi.advanceTimersByTime(25000);
    });
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
    });

    // Advance past absolute session time
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(onTimeout).toHaveBeenCalled();
  });

  it('should call onTimeout immediately if absolute session already expired', () => {
    const onTimeout = vi.fn();
    const loginTime = Date.now() - 70000; // 70 seconds ago

    renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
        absoluteSessionMs: 60000, // 60 seconds
        loginTime,
      })
    );

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('should not start timers when disabled', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
        enabled: false,
      })
    );

    act(() => {
      vi.advanceTimersByTime(35000);
    });

    expect(result.current.showWarning).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('should clean up timers on unmount', () => {
    const onTimeout = vi.fn();
    const { unmount } = renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
      })
    );

    unmount();

    act(() => {
      vi.advanceTimersByTime(35000);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('should track remaining time during countdown', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 30000,
        warningBeforeTimeoutMs: 5000,
      })
    );

    // Advance to warning time
    act(() => {
      vi.advanceTimersByTime(25000);
    });

    expect(result.current.showWarning).toBe(true);

    // Advance 1 second - countdown should update
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Remaining should be approximately 4 seconds (5000 - 1000 = 4000)
    expect(result.current.remainingMs).toBeLessThanOrEqual(4000);
    expect(result.current.remainingMs).toBeGreaterThan(0);
  });

  it('should listen to mouse, keyboard, touch, scroll, and click events', () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionTimeout({
        onTimeout,
        idleTimeoutMs: 10000,
        warningBeforeTimeoutMs: 2000,
      })
    );

    // Advance 7 seconds
    act(() => {
      vi.advanceTimersByTime(7000);
    });

    // Simulate keyboard activity
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    // Should not show warning yet (timer was reset)
    act(() => {
      vi.advanceTimersByTime(7000);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
