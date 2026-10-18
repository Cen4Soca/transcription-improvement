/**
 * SessionTimeoutWarning - アイドルタイムアウト残り5分前に警告通知を表示するコンポーネント
 *
 * 「続行」ボタンでアイドルタイマーをリセットする。
 *
 * Requirements: 9.10, 11.8
 */

interface SessionTimeoutWarningProps {
  /** Whether the warning is visible */
  visible: boolean;
  /** Remaining time in milliseconds before timeout */
  remainingMs: number;
  /** Callback when user clicks "Continue" to reset idle timer */
  onContinue: () => void;
}

/**
 * Format remaining milliseconds to MM:SS display string
 */
function formatRemainingTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SessionTimeoutWarning({
  visible,
  remainingMs,
  onContinue,
}: SessionTimeoutWarningProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2
          id="session-timeout-title"
          className="text-lg font-semibold text-gray-900 mb-2"
        >
          セッションがまもなく期限切れになります
        </h2>
        <p
          id="session-timeout-description"
          className="text-gray-600 mb-4"
        >
          セッションがまもなく期限切れになります。続行しますか？
        </p>
        <p className="text-2xl font-mono text-center text-red-600 mb-6" aria-live="polite">
          残り {formatRemainingTime(remainingMs)}
        </p>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onContinue}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            autoFocus
          >
            続行
          </button>
        </div>
      </div>
    </div>
  );
}
