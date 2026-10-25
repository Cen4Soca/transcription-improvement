import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Production idle-timeout defaults.
 *
 * - Idle timeout fires after 30 minutes of inactivity.
 * - The warning dialog appears 5 minutes before the timeout.
 *
 * Both values can be overridden for E2E testing via Vite env vars so the flow
 * can be exercised quickly without waiting 25+ minutes:
 * - `VITE_IDLE_TIMEOUT_MS`  → overrides the idle timeout (`idleMs`)
 * - `VITE_IDLE_WARNING_MS`  → overrides the warning window (`warningMs`)
 *
 * When an env var is absent or not a positive number, the production default
 * is used.
 */
export const IDLE_TIMEOUT_DEFAULTS = {
  /** Idle timeout in milliseconds (30 minutes). */
  IDLE_MS: 30 * 60 * 1000,
  /** Warning window before timeout in milliseconds (5 minutes). */
  WARNING_MS: 5 * 60 * 1000,
} as const;

/** User activity events that reset the idle timer. */
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'keydown',
  'click',
  'scroll',
  'touchstart',
];

/** Countdown tick interval in milliseconds (~once per second). */
const TICK_MS = 1000;

/**
 * Parse a Vite env value into a positive number, or return the fallback.
 */
function parsePositiveMs(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the default idle/warning thresholds, honoring Vite env overrides.
 */
export function resolveIdleTimeoutDefaults(): { idleMs: number; warningMs: number } {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    idleMs: parsePositiveMs(env.VITE_IDLE_TIMEOUT_MS, IDLE_TIMEOUT_DEFAULTS.IDLE_MS),
    warningMs: parsePositiveMs(env.VITE_IDLE_WARNING_MS, IDLE_TIMEOUT_DEFAULTS.WARNING_MS),
  };
}

export interface UseIdleTimeoutOptions {
  /** Idle timeout in ms. Defaults to the resolved production/env value. */
  idleMs?: number;
  /** How long before timeout the warning appears, in ms. Defaults to resolved value. */
  warningMs?: number;
  /** Callback invoked when the idle timeout fully elapses (remaining hits 0). */
  onTimeout?: () => void;
  /** Whether the timer is active. Defaults to true. */
  enabled?: boolean;
}

export interface UseIdleTimeoutReturn {
  /** Whether the timeout warning should be shown (remaining <= warningMs). */
  showWarning: boolean;
  /** Remaining time in ms before full timeout. Counts down during the warning window. */
  remainingMs: number;
  /** Reset the idle timer (e.g. when the user clicks "続行"). */
  reset: () => void;
}

/**
 * useIdleTimeout - アイドルタイムアウトを追跡する表示専用フック
 *
 * ユーザー操作（mousemove/keydown/click/scroll/touchstart）でアイドルタイマーを
 * リセットする。アイドル時間が `idleMs - warningMs` に達すると `showWarning` が
 * true になり、`remainingMs` が `warningMs` から 0 までおよそ 1 秒ごとに
 * カウントダウンする。0 に達すると `onTimeout` を呼び出す。
 *
 * 本番既定値はアイドル 30 分 / 警告 5 分前。`VITE_IDLE_TIMEOUT_MS` /
 * `VITE_IDLE_WARNING_MS` で上書きでき、E2E では短時間で検証できる
 * （{@link resolveIdleTimeoutDefaults} 参照）。
 *
 * Requirements: 9.10, 11.8
 */
export function useIdleTimeout(options: UseIdleTimeoutOptions = {}): UseIdleTimeoutReturn {
  const resolved = resolveIdleTimeoutDefaults();
  const idleMs = options.idleMs ?? resolved.idleMs;
  const warningMs = options.warningMs ?? resolved.warningMs;
  const enabled = options.enabled ?? true;

  const [showWarning, setShowWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState(idleMs);

  const lastActivityRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(options.onTimeout);
  const timedOutRef = useRef(false);

  // Keep the onTimeout ref current without restarting the timer loop.
  useEffect(() => {
    onTimeoutRef.current = options.onTimeout;
  }, [options.onTimeout]);

  const reset = useCallback(() => {
    lastActivityRef.current = Date.now();
    timedOutRef.current = false;
    setShowWarning(false);
    setRemainingMs(idleMs);
  }, [idleMs]);

  useEffect(() => {
    if (!enabled) {
      setShowWarning(false);
      setRemainingMs(idleMs);
      return;
    }

    // (Re)start tracking from "now" whenever thresholds or enablement change.
    lastActivityRef.current = Date.now();
    timedOutRef.current = false;

    const handleActivity = () => {
      // While the warning is visible, only an explicit reset() (続行) resumes;
      // passive activity must not silently dismiss the warning.
      if (timedOutRef.current) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= idleMs - warningMs) return;
      lastActivityRef.current = Date.now();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, idleMs - elapsed);
      const warningThreshold = idleMs - warningMs;

      setRemainingMs(remaining);

      if (remaining <= 0) {
        // Full timeout: hide the warning and fire onTimeout once.
        setShowWarning(false);
        if (!timedOutRef.current) {
          timedOutRef.current = true;
          onTimeoutRef.current?.();
        }
      } else {
        // Show the warning once the elapsed idle time crosses the threshold.
        setShowWarning(elapsed >= warningThreshold);
      }
    }, TICK_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, idleMs, warningMs]);

  return { showWarning, remainingMs, reset };
}
