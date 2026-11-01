import { useTranslation } from 'react-i18next';
import type { SyncStatus } from '../services/offline-sync-manager';

/**
 * SyncStatusIndicator - オフライン時のローカルキュー状態と同期進捗を表示するコンポーネント
 *
 * 「同期中...」「同期完了」「同期失敗」を表示する。
 * 同期失敗時は手動再試行ボタンを表示する。
 *
 * Requirements: 11.10, 11.11
 */

interface SyncStatusIndicatorProps {
  /** Current sync status */
  status: SyncStatus;
  /** Callback for manual retry when sync has failed */
  onRetry?: () => void;
}

export function SyncStatusIndicator({ status, onRetry }: SyncStatusIndicatorProps) {
  const { t } = useTranslation('common');

  if (status === 'idle') {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 rounded-lg shadow-lg px-4 py-3 text-sm font-medium flex items-center gap-2"
      data-testid="sync-status-indicator"
      style={getContainerStyle(status)}
    >
      {status === 'syncing' && (
        <>
          <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span>{t('sync.syncing')}</span>
        </>
      )}
      {status === 'completed' && (
        <>
          <span aria-hidden="true">✓</span>
          <span>{t('sync.completed')}</span>
        </>
      )}
      {status === 'failed' && (
        <>
          <span aria-hidden="true">✗</span>
          <span>{t('sync.failed')}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
            >
              {t('sync.retry')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function getContainerStyle(status: SyncStatus): React.CSSProperties {
  switch (status) {
    case 'syncing':
      return { backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' };
    case 'completed':
      return { backgroundColor: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' };
    case 'failed':
      return { backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' };
    default:
      return {};
  }
}
