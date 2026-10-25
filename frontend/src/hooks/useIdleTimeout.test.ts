import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimeout } from './useIdleTimeout';

// Use small thresholds so the flow is deterministic under fake timers.
// idleMs = 30s, warningMs = 5s → warning appears at the 25s mark.
const IDLE_MS = 30_000;
const WARNING_MS = 5_000;

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show a warning before the threshold', () => {
    const { result } = renderHook(() =>
      useIdleTimeout({ idleMs: IDLE_MS, warningMs: WARNING_MS })
    );

    expect(result.current.showWarning).toBe(false);

    act(() => {
      vi.advanceTimersByTime(24_000);
    });

    expect(result.current.showWarning).toBe(false);
  });

  it('shows the warning at the threshold with remainingMs counting down', () => {
    const { result } = renderHook(() =>
      useIdleTimeout({ idleMs: IDLE_MS, warningMs: WARNING_MS })
    );

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    expect(result.current.showWarning).toBe(true);
    expect(result.current.remainingMs).toBeLessThanOrEqual(WARNING_MS);
    expect(result.current.remainingMs).toBeGreaterThan(0);

    const before = result.current.remainingMs;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingMs).toBeLessThan(before);
  });

  it('hides the warning when reset is called', () => {
    const { result } = renderHook(() =>
      useIdleTimeout({ idleMs: IDLE_MS, warningMs: WARNING_MS })
    );

    act(() => {
      vi.advanceTimersByTime(26_000);
    });
    expect(result.current.showWarning).toBe(true);

    act(() => {
      result.current.reset();
    });
    expect(result.current.showWarning).toBe(false);
    expect(result.current.remainingMs).toBe(IDLE_MS);

    // Should not time out until a fresh full idle period elapses.
    const onTimeout = vi.fn();
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('hides the warning on user activity before the threshold', () => {
    const { result } = renderHook(() =>
      useIdleTimeout({ idleMs: IDLE_MS, warningMs: WARNING_MS })
    );

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    // Activity before the warning threshold resets the idle timer.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
    });

    // 20s more would have crossed the 25s threshold without the reset.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(result.current.showWarning).toBe(false);
  });

  it('calls onTimeout once when remainingMs hits 0', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimeout({ idleMs: IDLE_MS, warningMs: WARNING_MS, onTimeout })
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.remainingMs).toBe(0);
    expect(result.current.showWarning).toBe(false);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    // Further ticks must not fire onTimeout again.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not run timers when disabled', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimeout({ idleMs: IDLE_MS, warningMs: WARNING_MS, onTimeout, enabled: false })
    );

    act(() => {
      vi.advanceTimersByTime(35_000);
    });

    expect(result.current.showWarning).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
