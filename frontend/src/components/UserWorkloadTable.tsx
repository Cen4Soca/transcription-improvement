import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitoringApi } from '../services/monitoring-api';
import type { UserWorkloadItem } from '../types/monitoring';
import { translateError } from '../utils/translateError';
import { UserSessionsPanel } from './UserSessionsPanel';

export interface UserWorkloadTableProps {
  api: Pick<MonitoringApi, 'listUserWorkload' | 'listUserSessions'>;
}

/**
 * UserWorkloadTable - ユーザー別の担当数 / 進行中数 / 滞留数（行展開で担当セッションの進捗）
 *
 * ADMIN は全ユーザー、TEAM_LEADER は自チームのメンバーのみ（サーバー側で絞り込み）。
 * Team Leader がユーザー管理画面（ADMIN 専用）に入れない代わりの導線として、
 * セッション一覧画面の「割当・進捗」から利用する。
 */
export function UserWorkloadTable({ api }: UserWorkloadTableProps) {
  const { t } = useTranslation('monitoring');
  const [items, setItems] = useState<UserWorkloadItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await api.listUserWorkload();
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
  }, [api]);

  const loadUserSessions = useCallback((userId: string) => api.listUserSessions(userId), [api]);

  if (error) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  if (!items) {
    return (
      <div role="status" aria-label={t('user.loadingAriaLabel')} className="text-sm text-gray-500">
        {t('user.loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="py-6 text-center text-gray-500">{t('user.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200" aria-label={t('user.tableAriaLabel')}>
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t('user.column.name')}</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t('user.column.role')}</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500">{t('user.column.assigned')}</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500">{t('user.column.inProgress')}</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500">{t('user.column.stalled')}</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500">{t('user.column.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {items.map((item) => {
            const expanded = expandedUserId === item.userId;
            return (
              <Fragment key={item.userId}>
                <tr>
                  <th scope="row" className="px-4 py-3 text-left text-sm font-normal text-gray-900">
                    {item.displayName}
                  </th>
                  <td className="px-4 py-3 text-sm text-gray-700">{t(`admin:user.role.${item.role}`)}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900">{item.assignedCount}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900">{item.inProgressCount}</td>
                  <td className="px-4 py-3 text-right text-sm">
                    <span className={item.stalledCount > 0 ? 'font-semibold text-amber-700' : 'text-gray-900'}>
                      {item.stalledCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={t(expanded ? 'user.collapseAriaLabel' : 'user.expandAriaLabel', {
                        name: item.displayName,
                      })}
                      onClick={() => setExpandedUserId(expanded ? null : item.userId)}
                      className="rounded px-2 py-1 text-sm text-blue-700 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {t(expanded ? 'user.collapse' : 'user.expand')}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-gray-50">
                    <td colSpan={6} className="px-4 py-3">
                      <UserSessionsPanel userId={item.userId} loadUserSessions={loadUserSessions} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
