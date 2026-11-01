import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewSession, ForceAggregateResult } from '../types/session';
import type { UserRole } from '../types/user';

export interface SessionAggregateControlsProps {
  session: ReviewSession;
  userRole: UserRole;
  /**
   * セッションを強制集約して確定する。成功時は集約サマリを resolve し、
   * 失敗時は日本語化済みメッセージを持つ Error を throw する（App 側で変換）。
   */
  onAggregate: (sessionId: string) => Promise<ForceAggregateResult>;
}

/**
 * SessionAggregateControls - セッションの強制集約（確定・完了）操作
 *
 * - ADMIN / TEAM_LEADER のみ表示（Reviewer には何も表示しない）
 * - 自動集約の最低レビュアー数に満たないセッションを手動で確定・完了させる
 * - ほぼ不可逆のため確認ステップを挟んでから POST /sessions/{sessionId}/aggregate を呼ぶ
 *
 * 権限・スコープの最終検証はバックエンドで行う。ここでは操作の入口のみ提供する。
 */
export function SessionAggregateControls({
  session,
  userRole,
  onAggregate,
}: SessionAggregateControlsProps) {
  const { t } = useTranslation('review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<ForceAggregateResult | null>(null);

  const canManage = userRole === 'ADMIN' || userRole === 'TEAM_LEADER';
  const isCompleted = session.status === 'COMPLETED';

  // Reviewer（および不明ロール）には強制集約 UI を一切見せない。
  if (!canManage) {
    return null;
  }

  const confirmRegionId = `aggregate-confirm-${session.sessionId}`;

  const handleExecute = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await onAggregate(session.sessionId);
      setResult(data);
      setShowConfirm(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('aggregate.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('aggregate.groupAriaLabel')}
      >
        <button
          type="button"
          onClick={() => {
            setShowConfirm((v) => !v);
            setError(null);
          }}
          disabled={isCompleted || busy}
          aria-expanded={showConfirm}
          aria-controls={confirmRegionId}
          aria-label={t('aggregate.aggregateButton')}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('aggregate.aggregateButton')}
        </button>
        {isCompleted && (
          <span className="text-xs text-gray-500">
            {t('aggregate.alreadyCompleted')}
          </span>
        )}
      </div>

      {/* Confirmation step (near-irreversible). */}
      {showConfirm && !isCompleted && (
        <div
          id={confirmRegionId}
          role="group"
          aria-label={t('aggregate.confirmAriaLabel')}
          className="rounded-md border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2"
        >
          <p className="text-xs text-amber-800">
            {t('aggregate.confirmMessage')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExecute}
              disabled={busy}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
            >
              {t('aggregate.execute')}
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

      {result && (
        <p className="text-xs text-green-700" role="status">
          {t('aggregate.resultSummary', {
            confirmed: result.confirmedCount,
            conflict: result.conflictCount,
            reviewers: result.totalReviewers,
          })}
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
