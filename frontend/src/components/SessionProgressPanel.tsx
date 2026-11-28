import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Result, AppError } from '../types/api';
import type { SessionProgress } from '../types/monitoring';
import { translateError } from '../utils/translateError';
import { formatSessionDate } from '../utils/session-format';
import { ProgressBar } from './ProgressBar';

export interface SessionProgressPanelProps {
  sessionId: string;
  /** GET /sessions/{sessionId}/progress を呼び出す */
  loadProgress: (sessionId: string) => Promise<Result<{ data: SessionProgress }, AppError>>;
}

/**
 * SessionProgressPanel - セッションの Reviewer 別進捗（行展開用）
 *
 * マウント時に 1 回だけ取得する。別セッションを表示するときは key で再マウントする。
 */
export function SessionProgressPanel({ sessionId, loadProgress }: SessionProgressPanelProps) {
  const { t } = useTranslation('monitoring');
  const [progress, setProgress] = useState<SessionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadProgress(sessionId);
      if (cancelled) return;
      if (result.ok) {
        setProgress(result.value.data);
      } else {
        setError(translateError(result.error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadProgress]);

  if (error) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  if (!progress) {
    return (
      <div role="status" aria-label={t('progress.loadingAriaLabel')} className="text-sm text-gray-500">
        {t('progress.loading')}
      </div>
    );
  }

  return (
    <section aria-label={t('progress.heading')} className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{t('progress.heading')}</h3>
        <span className="text-xs text-gray-500">
          {t('progress.summary', { total: progress.totalSegments })}
        </span>
      </div>

      {progress.totalSegments === 0 && (
        <p className="text-sm text-gray-500">{t('progress.noSegments')}</p>
      )}

      {progress.reviewers.length === 0 ? (
        <p className="text-sm text-gray-500">{t('progress.empty')}</p>
      ) : (
        <table className="min-w-full text-sm" aria-label={t('progress.tableAriaLabel')}>
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th scope="col" className="py-1 pr-4 font-medium">{t('progress.column.reviewer')}</th>
              <th scope="col" className="py-1 pr-4 font-medium">{t('progress.column.progress')}</th>
              <th scope="col" className="py-1 pr-4 font-medium">{t('progress.column.segments')}</th>
              <th scope="col" className="py-1 font-medium">{t('progress.column.lastActivity')}</th>
            </tr>
          </thead>
          <tbody>
            {progress.reviewers.map((reviewer) => (
              <tr key={reviewer.userId} className="border-t border-gray-100">
                <th scope="row" className="py-1 pr-4 text-left font-normal text-gray-900">
                  {reviewer.displayName}
                </th>
                <td className="py-1 pr-4">
                  <ProgressBar
                    percent={reviewer.progressPercent}
                    label={t('progress.barAriaLabel', {
                      name: reviewer.displayName,
                      corrected: reviewer.correctedSegments,
                      total: reviewer.totalSegments,
                    })}
                  />
                </td>
                <td className="py-1 pr-4 text-gray-700">
                  {reviewer.correctedSegments} / {reviewer.totalSegments}
                </td>
                <td className="py-1 text-gray-600">
                  {reviewer.lastActivityAt ? (
                    <time dateTime={reviewer.lastActivityAt}>
                      {formatSessionDate(reviewer.lastActivityAt)}
                    </time>
                  ) : (
                    t('progress.neverActive')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
