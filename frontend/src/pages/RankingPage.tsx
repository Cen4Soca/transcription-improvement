import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RankingPeriod } from '../types/ranking';

export interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  answerCount: number;
  accuracyRate: number;
  score: number;
}

export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface RankingPageProps {
  rankings: RankingEntry[];
  currentUser: RankingEntry | null;
  currentUserId: string;
  isLoading?: boolean;
  error?: { message: string } | null;
  selectedPeriod?: RankingPeriod;
  onPeriodChange?: (period: RankingPeriod) => void;
  pagination?: PaginationInfo;
  onPageChange?: (page: number) => void;
}

const PERIOD_OPTIONS: { value: RankingPeriod; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'period.all' },
  { value: 'THIS_MONTH', labelKey: 'period.thisMonth' },
  { value: 'THIS_YEAR', labelKey: 'period.thisYear' },
  { value: 'LAST_30_DAYS', labelKey: 'period.last30Days' },
  { value: 'LAST_90_DAYS', labelKey: 'period.last90Days' },
];

/**
 * RankingPage - コントリビューターランキング画面
 *
 * Requirements: 12.1, 12.3, 12.5, 12.6, 12.7, 12.8, 12.11, 12.12, 11.7
 */
export function RankingPage({
  rankings,
  currentUser,
  currentUserId,
  isLoading = false,
  error,
  selectedPeriod = 'ALL',
  onPeriodChange,
  pagination,
  onPageChange,
}: RankingPageProps) {
  const { t } = useTranslation('ranking');
  const [activePeriod, setActivePeriod] = useState<RankingPeriod>(selectedPeriod);

  const handlePeriodChange = (period: RankingPeriod) => {
    setActivePeriod(period);
    onPeriodChange?.(period);
  };

  // Determine if current user is outside the displayed rankings
  const isCurrentUserOutsideRankings = useMemo(() => {
    if (!currentUser) return false;
    return !rankings.some((r) => r.userId === currentUserId);
  }, [rankings, currentUser, currentUserId]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-64"
        role="status"
        aria-label={t('loadingAriaLabel')}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">{t('loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64" role="alert">
        <p className="text-red-600">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" role="main" aria-label={t('pageTitle')}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">{t('pageTitle')}</h1>
      </div>

      {/* Period filter tabs */}
      <div
        className="flex gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50 flex-wrap"
        role="tablist"
        aria-label={t('periodFilterAriaLabel')}
      >
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={activePeriod === option.value}
            onClick={() => handlePeriodChange(option.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              activePeriod === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
            }`}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      {/* Ranking table */}
      <div className="flex-1 overflow-auto px-4 py-3" role="tabpanel">
        {rankings.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-gray-500">{t('emptyState')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse"
              aria-label={t('tableAriaLabel')}
            >
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th
                    scope="col"
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('column.rank')}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('column.userName')}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('column.answerCount')}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('column.accuracyRate')}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('column.score')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((entry) => (
                  <RankingRow
                    key={entry.userId}
                    entry={entry}
                    isCurrentUser={entry.userId === currentUserId}
                    t={t}
                  />
                ))}
                {/* Show current user at bottom if outside rankings (Req 12.8) */}
                {isCurrentUserOutsideRankings && currentUser && (
                  <>
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-1 text-center text-xs text-gray-400"
                      >
                        ···
                      </td>
                    </tr>
                    <RankingRow
                      entry={currentUser}
                      isCurrentUser={true}
                      t={t}
                    />
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination (Req 11.7) */}
      {pagination && pagination.totalPages > 1 && (
        <div
          className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white"
          role="navigation"
          aria-label={t('paginationAriaLabel')}
        >
          <p className="text-sm text-gray-700">
            {t('itemRange', {
              totalItems: pagination.totalItems,
              start: (pagination.currentPage - 1) * pagination.pageSize + 1,
              end: Math.min(pagination.currentPage * pagination.pageSize, pagination.totalItems),
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!pagination.hasPreviousPage}
              onClick={() => onPageChange?.(pagination.currentPage - 1)}
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label={t('previousAriaLabel')}
            >
              {t('previous')}
            </button>
            <span className="flex items-center px-3 py-1.5 text-sm text-gray-700">
              {pagination.currentPage} / {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={!pagination.hasNextPage}
              onClick={() => onPageChange?.(pagination.currentPage + 1)}
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label={t('nextAriaLabel')}
            >
              {t('next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface RankingRowProps {
  entry: RankingEntry;
  isCurrentUser: boolean;
  t: TFunction;
}

function RankingRow({ entry, isCurrentUser, t }: RankingRowProps) {
  return (
    <tr
      className={`border-b border-gray-100 ${
        isCurrentUser
          ? 'bg-blue-50 font-semibold'
          : 'hover:bg-gray-50'
      }`}
      aria-current={isCurrentUser ? 'true' : undefined}
    >
      <td className="px-4 py-3 text-sm text-gray-900">
        {entry.rank}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {entry.displayName}
        {isCurrentUser && (
          <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
            {t('you')}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700 text-right">
        {entry.answerCount}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700 text-right">
        {entry.accuracyRate.toFixed(1)}%
      </td>
      <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
        {entry.score.toFixed(1)}
      </td>
    </tr>
  );
}
