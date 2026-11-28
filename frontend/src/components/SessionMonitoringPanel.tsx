import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitoringApi } from '../services/monitoring-api';
import type { MonitoringSessionItem, SessionMonitoringFilters } from '../types/monitoring';
import type { ReviewSessionStatus } from '../types/session';
import type { Team, TeamMembership } from '../types/team';
import type { PaginatedResponse } from '../types/api';
import { translateError } from '../utils/translateError';
import { formatSessionDate } from '../utils/session-format';
import { SessionProgressPanel } from './SessionProgressPanel';
import { UserWorkloadTable } from './UserWorkloadTable';

export interface SessionMonitoringPanelProps {
  api: Pick<
    MonitoringApi,
    'listSessions' | 'getSessionProgress' | 'listUserWorkload' | 'listUserSessions'
  >;
  /** 絞り込み用のチーム一覧（ADMIN は全チーム、TEAM_LEADER は自チーム） */
  teams: Team[];
  /** 指定チームのメンバー一覧（Reviewer の絞り込み候補の取得用） */
  loadTeamMembers?: (teamId: string) => Promise<TeamMembership[]>;
  /** セッションの校閲画面を開く */
  onOpenSession?: (sessionId: string) => void;
}

type SubView = 'sessions' | 'users';

const STATUS_VALUES: ReviewSessionStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

const STATUS_BADGE: Record<ReviewSessionStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
};

/**
 * SessionMonitoringPanel - セッションの割当状況・ステータス・Reviewer 進捗の確認（ADMIN / TEAM_LEADER）
 *
 * - セッション別: 割当チーム/ユーザー、参加人数、未割当・滞留バッジ。行を開くと Reviewer 別進捗。
 * - ユーザー別: 担当数 / 進行中数 / 滞留数。行を開くと担当セッションごとの進捗。
 * 一覧では進捗の割合を集計せず、行展開（詳細 API）でのみ算出する（読み取りコスト抑制）。
 */
export function SessionMonitoringPanel({
  api,
  teams,
  loadTeamMembers,
  onOpenSession,
}: SessionMonitoringPanelProps) {
  const { t } = useTranslation('monitoring');
  const [subView, setSubView] = useState<SubView>('sessions');

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t('subview.ariaLabel')} className="flex gap-2">
        {(['sessions', 'users'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={subView === view}
            onClick={() => setSubView(view)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              subView === view
                ? 'bg-blue-600 text-white'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            {t(view === 'sessions' ? 'subview.bySession' : 'subview.byUser')}
          </button>
        ))}
      </div>

      {subView === 'sessions' ? (
        <SessionsView
          api={api}
          teams={teams}
          loadTeamMembers={loadTeamMembers}
          onOpenSession={onOpenSession}
        />
      ) : (
        <UserWorkloadTable api={api} />
      )}
    </div>
  );
}

function SessionsView({
  api,
  teams,
  loadTeamMembers,
  onOpenSession,
}: SessionMonitoringPanelProps) {
  const { t } = useTranslation('monitoring');
  const [filters, setFilters] = useState<SessionMonitoringFilters>({});
  const [result, setResult] = useState<PaginatedResponse<MonitoringSessionItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<{ userId: string; name: string }[]>([]);

  // Reviewer 絞り込み候補: 表示対象チームのメンバーを重複なしで集める。
  useEffect(() => {
    if (!loadTeamMembers || teams.length === 0) return;
    let cancelled = false;
    void (async () => {
      const lists = await Promise.all(teams.map((team) => loadTeamMembers(team.teamId)));
      if (cancelled) return;
      const byId = new Map<string, string>();
      for (const member of lists.flat()) {
        byId.set(member.userId, member.displayName ?? member.email ?? member.userId);
      }
      setReviewers([...byId].map(([userId, name]) => ({ userId, name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [teams, loadTeamMembers]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      const response = await api.listSessions(filters);
      if (cancelled) return;
      if (response.ok) {
        setResult(response.value.data);
        setError(null);
      } else {
        setError(translateError(response.error));
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, filters]);

  const loadProgress = useCallback((sessionId: string) => api.getSessionProgress(sessionId), [api]);

  // フィルター変更時は 1 ページ目に戻し、展開状態も閉じる。
  const updateFilters = (patch: Partial<SessionMonitoringFilters>) => {
    setExpandedId(null);
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const changePage = (page: number) => {
    setExpandedId(null);
    setFilters((prev) => ({ ...prev, page }));
  };

  const pagination = result?.pagination;
  const items = useMemo(() => result?.items ?? [], [result]);

  return (
    <section aria-label={t('session.heading')} className="space-y-3">
      <h2 className="text-base font-semibold text-gray-900">{t('session.heading')}</h2>

      <form
        aria-label={t('session.filter.ariaLabel')}
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3"
      >
        <div>
          <label htmlFor="monitoring-status" className="block text-xs font-medium text-gray-700">
            {t('session.filter.status')}
          </label>
          <select
            id="monitoring-status"
            value={filters.status ?? ''}
            onChange={(e) =>
              updateFilters({ status: (e.target.value || undefined) as ReviewSessionStatus | undefined })
            }
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('session.filter.statusAll')}</option>
            {STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="monitoring-team" className="block text-xs font-medium text-gray-700">
            {t('session.filter.team')}
          </label>
          <select
            id="monitoring-team"
            value={filters.teamId ?? ''}
            onChange={(e) => updateFilters({ teamId: e.target.value || undefined })}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('session.filter.teamAll')}</option>
            {teams.map((team) => (
              <option key={team.teamId} value={team.teamId}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="monitoring-reviewer" className="block text-xs font-medium text-gray-700">
            {t('session.filter.reviewer')}
          </label>
          <select
            id="monitoring-reviewer"
            value={filters.userId ?? ''}
            onChange={(e) => updateFilters({ userId: e.target.value || undefined })}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('session.filter.reviewerAll')}</option>
            {reviewers.map((reviewer) => (
              <option key={reviewer.userId} value={reviewer.userId}>
                {reviewer.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={filters.unassignedOnly ?? false}
            onChange={(e) => updateFilters({ unassignedOnly: e.target.checked || undefined })}
          />
          {t('session.filter.unassignedOnly')}
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={filters.stalledOnly ?? false}
            onChange={(e) => updateFilters({ stalledOnly: e.target.checked || undefined })}
          />
          {t('session.filter.stalledOnly')}
        </label>
      </form>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {isLoading && !result ? (
        <div role="status" aria-label={t('session.loadingAriaLabel')} className="text-sm text-gray-500">
          {t('session.loading')}
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-gray-500">{t('session.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table
            className="min-w-full divide-y divide-gray-200"
            aria-label={t('session.tableAriaLabel')}
            aria-busy={isLoading}
          >
            <thead className="bg-gray-50">
              <tr>
                {(['name', 'status', 'team', 'assignee', 'participants', 'flags', 'lastActivity', 'actions'] as const).map(
                  (column) => (
                    <th
                      key={column}
                      scope="col"
                      className={`px-4 py-3 text-xs font-medium text-gray-500 ${
                        column === 'participants' || column === 'actions' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {t(`session.column.${column}`)}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => {
                const expanded = expandedId === item.sessionId;
                return (
                  <Fragment key={item.sessionId}>
                    <tr>
                      <th scope="row" className="px-4 py-3 text-left text-sm font-normal text-gray-900">
                        {item.name}
                      </th>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[item.status]}`}
                        >
                          {t(`status.${item.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {item.assignedTeamName ?? t('session.noTeam')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {item.assignedUserName ?? t('session.noAssignee')}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900">{item.participantCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {item.isUnassigned && (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                              {t('session.badge.unassigned')}
                            </span>
                          )}
                          {item.isStalled && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              {t('session.badge.stalled')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.lastActivityAt ? (
                          <time dateTime={item.lastActivityAt}>{formatSessionDate(item.lastActivityAt)}</time>
                        ) : (
                          t('session.notComputed')
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={t(expanded ? 'session.collapseAriaLabel' : 'session.expandAriaLabel', {
                              name: item.name,
                            })}
                            onClick={() => setExpandedId(expanded ? null : item.sessionId)}
                            className="rounded px-2 py-1 text-sm text-blue-700 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {t(expanded ? 'session.collapse' : 'session.expand')}
                          </button>
                          {onOpenSession && (
                            <button
                              type="button"
                              aria-label={t('session.openReviewAriaLabel', { name: item.name })}
                              onClick={() => onOpenSession(item.sessionId)}
                              className="rounded px-2 py-1 text-sm text-blue-700 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {t('session.openReview')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-3">
                          <SessionProgressPanel sessionId={item.sessionId} loadProgress={loadProgress} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <nav aria-label={t('session.pagination.ariaLabel')} className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={!pagination.hasPreviousPage}
            onClick={() => changePage(pagination.currentPage - 1)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('session.pagination.previous')}
          </button>
          <span className="text-sm text-gray-600">
            {t('session.pagination.pageInfo', {
              current: pagination.currentPage,
              total: pagination.totalPages,
            })}
          </span>
          <button
            type="button"
            disabled={!pagination.hasNextPage}
            onClick={() => changePage(pagination.currentPage + 1)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('session.pagination.next')}
          </button>
        </nav>
      )}
    </section>
  );
}
