import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Session timeout configuration constants
 */
export const SESSION_TIMEOUT_CONFIG = {
  /** Idle timeout in milliseconds (30 minutes) */
  IDLE_TIMEOUT_MS: 30 * 60 * 1000,
  /** Warning threshold before idle timeout in milliseconds (5 minutes before) */
  WARNING_BEFORE_TIMEOUT_MS: 5 * 60 * 1000,
  /** Absolute session duration in milliseconds (8 hours) */
  ABSOLUTE_SESSION_MS: 8 * 60 * 60 * 1000,
} as const;

/** User activity events to track for idle detection */
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousedown',
  'mousemove',
  'keydown',
  'touchstart',
  'scroll',
  'click',
];

export interface UseSessionTimeoutOptions {
  /** Idle timeout in ms (default: 30 minutes) */
  idleTimeoutMs?: number;
  /** Warning before timeout in ms (default: 5 minutes) */
  warningBeforeTimeoutMs?: number;
  /** Absolute session duration in ms (default: 8 hours) */
  absoluteSessionMs?: number;
  /** Callback when session times out (idle or absolute) */
  onTimeout: () => void;
  /** Whether the hook is enabled (e.g., only when authenticated) */
  enabled?: boolean;
  /** Login timestamp in ms since epoch (defaults to Date.now() on mount) */
  loginTime?: number;
}

export interface UseSessionTimeoutReturn {
  /** Whether the warning dialog should be shown */
  showWarning: boolean;
  /** Remaining time in ms before idle timeout */
  remainingMs: number;
  /** Reset the idle timer (e.g., when user clicks "Continue") */
  resetIdleTimer: () => void;
  /** Whether the session has expired due to absolute timeout */
  isAbsoluteExpired: boolean;
}

/**
 * useSessionTimeout - セッションタイムアウト管理カスタムフック
 *
 * - アイドルタイムアウト 30 分（ユーザーアクティビティで検知）
 * - 残り 5 分で警告通知表示
 * - 「続行」ボタンでアイドルタイマーリセット
 * - 絶対セッション期限 8 時間（ログインからの経過時間）
 * - タイムアウト時にコールバック実行（ログイン画面リダイレクト用）
 *
 * Requirements: 9.10, 9.11, 11.8
 */
export function useSessionTimeout({
  idleTimeoutMs = SESSION_TIMEOUT_CONFIG.IDLE_TIMEOUT_MS,
  warningBeforeTimeoutMs = SESSION_TIMEOUT_CONFIG.WARNING_BEFORE_TIMEOUT_MS,
  absoluteSessionMs = SESSION_TIMEOUT_CONFIG.ABSOLUTE_SESSION_MS,
  onTimeout,
  enabled = true,
  loginTime,
}: UseSessionTimeoutOptions): UseSessionTimeoutReturn {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState(idleTimeoutMs);
  // Compute the absolute-expiry state once at mount. When the session already
  // exceeded its absolute lifetime on mount, this initializes to true so no
  // setState is needed inside the init effect for that case.
  const [isAbsoluteExpired, setIsAbsoluteExpired] = useState<boolean>(
    () => enabled && Date.now() - (loginTime ?? Date.now()) >= absoluteSessionMs
  );
  const [prevEnabled, setPrevEnabled] = useState(enabled);

  // Reset state when `enabled` changes (adjust state during render instead of in
  // an effect). Flipping to false hides the warning; (re)enabling restores the
  // initial idle state, matching the previous synchronous reset in startIdleTimer.
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    if (enabled) {
      setShowWarning(false);
      setRemainingMs(idleTimeoutMs);
    } else {
      setShowWarning(false);
    }
  }

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const absoluteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(0);
  const loginTimeRef = useRef<number>(0);
  const loginTimePropRef = useRef<number | undefined>(loginTime);
  const onTimeoutRef = useRef(onTimeout);

  // Keep onTimeout and loginTime refs up to date
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);
  useEffect(() => {
    loginTimePropRef.current = loginTime;
  }, [loginTime]);

  const clearAllTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (absoluteTimerRef.current) {
      clearTimeout(absoluteTimerRef.current);
      absoluteTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
    countdownIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, idleTimeoutMs - elapsed);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }
    }, 1000);
  }, [idleTimeoutMs]);

  // Schedule the warning/idle timers without resetting React state. Safe to call
  // from inside an effect because it only touches timer refs (an external system).
  const scheduleIdleTimers = useCallback(() => {
    // Clear existing idle/warning timers
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    lastActivityRef.current = Date.now();

    // Set warning timer (fires at idleTimeout - warningBefore)
    const warningDelay = idleTimeoutMs - warningBeforeTimeoutMs;
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown();
    }, warningDelay);

    // Set idle timeout timer
    idleTimerRef.current = setTimeout(() => {
      setShowWarning(false);
      onTimeoutRef.current();
    }, idleTimeoutMs);
  }, [idleTimeoutMs, warningBeforeTimeoutMs, startCountdown]);

  const startIdleTimer = useCallback(() => {
    setShowWarning(false);
    setRemainingMs(idleTimeoutMs);
    scheduleIdleTimers();
  }, [idleTimeoutMs, scheduleIdleTimers]);

  const resetIdleTimer = useCallback(() => {
    if (!enabled) return;
    startIdleTimer();
  }, [enabled, startIdleTimer]);

  // Handle user activity
  const handleActivity = useCallback(() => {
    if (!enabled) return;
    // Only reset if warning is not showing
    // When warning is showing, only "Continue" button should reset
    if (!showWarning) {
      startIdleTimer();
    }
  }, [enabled, showWarning, startIdleTimer]);

  // Set up activity event listeners
  useEffect(() => {
    if (!enabled) return;

    const handler = () => handleActivity();

    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, handler, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, handler);
      }
    };
  }, [enabled, handleActivity]);

  // Initialize timers when enabled
  useEffect(() => {
    if (loginTimeRef.current === 0) {
      loginTimeRef.current = loginTimePropRef.current ?? Date.now();
    }

    if (!enabled) {
      clearAllTimers();
      return;
    }

    // Start idle timer (scheduling only; state resets happen during render)
    scheduleIdleTimers();

    // Start absolute session timer
    const elapsed = Date.now() - loginTimeRef.current;
    const remainingAbsolute = absoluteSessionMs - elapsed;

    if (remainingAbsolute <= 0) {
      // isAbsoluteExpired was already initialized to true at mount for this case,
      // so only the terminal callback needs to fire here (no setState in effect).
      onTimeoutRef.current();
    } else {
      absoluteTimerRef.current = setTimeout(() => {
        setIsAbsoluteExpired(true);
        clearAllTimers();
        onTimeoutRef.current();
      }, remainingAbsolute);
    }

    return () => {
      clearAllTimers();
    };
  }, [enabled, absoluteSessionMs, scheduleIdleTimers, clearAllTimers]);

  return {
    showWarning,
    remainingMs,
    resetIdleTimer,
    isAbsoluteExpired,
  };
}
