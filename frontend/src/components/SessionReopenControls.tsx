import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewSession, ReopenSessionResult } from '../types/session';
import type { UserRole } from '../types/user';

export interface SessionReopenControlsProps {
  session: ReviewSession;
  userRole: UserRole;
  /**
   * 完了済みセッションを進行中に戻す。成功時は結果を resolve し、
   * 失敗時は日本語化済みメッセージを持つ Error を throw する（App 側で変換）。
   */
  onReopen: (sessionId: string) => Promise<ReopenSessionResult>;
}

/**
 * SessionReopenControls - 完了済みセッションを進行中に戻す（差し戻し）操作
 *
 * - ADMIN / TEAM_LEADER のみ表示（Reviewer には何も表示しない）
 * - 完了したトランスクリプションの品質が悪いとき、セッションを再び進行中へ戻す
 * - COMPLETED のセッションのみ差し戻せる（それ以外はボタンを無効化）
 * - 確認ステップを挟んでから POST /sessions/{sessionId}/reopen を呼ぶ
 * - 確定済みの ConsensusResult / Segment は保持される（ポリシー A）
 *
 * 権限・スコープの最終検証はバックエンドで行う。ここでは操作の入口のみ提供する。
 */
export function SessionReopenControls({
  session,
  userRole,
  onReopen,
}: SessionReopenControlsProps) {
  const { t } = useTranslation('review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);

  const canManage = userRole === 'ADMIN' || userRole === 'TEAM_LEADER';
  const isCompleted = session.status === 'COMPLETED';

  // Reviewer（および不明ロール）には差し戻し UI を一切見せない。
  if (!canManage) {
    return null;
  }

  const confirmRegionId = `reopen-confirm-${session.sessionId}`;

  const handleExecute = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReopen(session.sessionId);
      setDone(true);
      setShowConfirm(false);
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : t('reopen.failed')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('reopen.groupAriaLabel')}
      >
        <button
          type="button"
          onClick={() => {
            setShowConfirm((v) => !v);
            setError(null);
          }}
          disabled={!isCompleted || busy}
          aria-expanded={showConfirm}
          aria-controls={confirmRegionId}
          aria-label={t('reopen.reopenButton')}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-slate-600 text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('reopen.reopenButton')}
        </button>
        {!isCompleted && (
          <span className="text-xs text-gray-500">
            {t('reopen.onlyCompleted')}
          </span>
        )}
      </div>

      {/* Confirmation step. */}
      {showConfirm && isCompleted && (
        <div
          id={confirmRegionId}
          role="group"
          aria-label={t('reopen.confirmAriaLabel')}
          className="rounded-md border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2"
        >
          <p className="text-xs text-slate-800">
            {t('reopen.confirmMessage')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExecute}
              disabled={busy}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-slate-600 text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
            >
              {t('reopen.execute')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirm(false);
                setError(null);
              }}
              disabled={busy}
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {t('common:cancel')}
            </button>
          </div>
        </div>
      )}

      {done && (
        <p className="text-xs text-green-700" role="status">
          {t('reopen.done')}
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
