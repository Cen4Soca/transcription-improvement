import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Result, AppError } from '../types/api';
import type { UserSessionItem } from '../types/monitoring';
import { translateError } from '../utils/translateError';
import { formatSessionDate } from '../utils/session-format';
import { ProgressBar } from './ProgressBar';

export interface UserSessionsPanelProps {
  userId: string;
  /** GET /monitoring/users/{userId}/sessions を呼び出す */
  loadUserSessions: (
    userId: string
  ) => Promise<Result<{ data: { items: UserSessionItem[] } }, AppError>>;
}

/**
 * UserSessionsPanel - ユーザーの担当セッションごとの進捗（行展開用）
 *
 * マウント時に 1 回だけ取得する。別ユーザーを表示するときは key で再マウントする。
 */
export function UserSessionsPanel({ userId, loadUserSessions }: UserSessionsPanelProps) {
  const { t } = useTranslation('monitoring');
  const [items, setItems] = useState<UserSessionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadUserSessions(userId);
      if (cancelled) return;
      if (result.ok) {
        setItems(result.value.data.items);
      } else {
        setError(translateError(result.error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, loadUserSessions]);

  if (error) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  if (!items) {
    return (
      <div
        role="status"
        aria-label={t('user.sessions.loadingAriaLabel')}
        className="text-sm text-gray-500"
      >
        {t('user.sessions.loading')}
      </div>
    );
  }

  return (
    <section aria-label={t('user.sessions.heading')} className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">{t('user.sessions.heading')}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('user.sessions.empty')}</p>
      ) : (
        <table className="min-w-full text-sm" aria-label={t('user.sessions.tableAriaLabel')}>
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th scope="col" className="py-1 pr-4 font-medium">{t('user.sessions.column.name')}</th>
              <th scope="col" className="py-1 pr-4 font-medium">{t('user.sessions.column.status')}</th>
              <th scope="col" className="py-1 pr-4 font-medium">{t('user.sessions.column.team')}</th>
              <th scope="col" className="py-1 pr-4 font-medium">{t('user.sessions.column.progress')}</th>
              <th scope="col" className="py-1 font-medium">{t('user.sessions.column.lastActivity')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.sessionId} className="border-t border-gray-100">
                <th scope="row" className="py-1 pr-4 text-left font-normal text-gray-900">
                  {item.name}
                  {item.isStalled && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {t('session.badge.stalled')}
                    </span>
                  )}
                </th>
                <td className="py-1 pr-4 text-gray-700">{t(`status.${item.status}`)}</td>
                <td className="py-1 pr-4 text-gray-700">
                  {item.assignedTeamName ?? t('session.noTeam')}
                </td>
                <td className="py-1 pr-4">
                  <ProgressBar
                    percent={item.progressPercent}
                    label={t('user.sessions.barAriaLabel', {
                      name: item.name,
                      corrected: item.correctedSegments,
                      total: item.totalSegments,
                    })}
                  />
                </td>
                <td className="py-1 text-gray-600">
                  {item.lastActivityAt ? (
                    <time dateTime={item.lastActivityAt}>{formatSessionDate(item.lastActivityAt)}</time>
                  ) : (
                    t('session.notComputed')
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
