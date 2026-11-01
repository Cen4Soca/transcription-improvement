import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ReviewSession, ReviewSessionStatus } from '../types/session';
import type { AppError } from '../types/api';
import { SessionNameEditor } from '../components/SessionNameEditor';
import { formatSessionDate } from '../utils/session-format';

export type FilterStatus = 'ALL' | ReviewSessionStatus;

export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface SessionListPageProps {
  sessions: ReviewSession[];
  isLoading?: boolean;
  error?: { message: string } | null;
  onSessionSelect?: (sessionId: string) => void;
  /** 画面タイトル（省略時は「校閲セッション一覧」） */
  title?: string;
  /** 各セッション項目の下に差し込むアクション（引き受け／割り当てなど） */
  renderSessionActions?: (session: ReviewSession) => ReactNode;
  /** セッション名の変更コールバック（成功で null, 失敗で AppError）。指定時のみ各項目に編集 UI を表示する */
  onRenameSession?: (sessionId: string, name: string) => Promise<AppError | null>;
  /**
   * 選択中のステータスフィルター（既定 'ALL'）。
   * onStatusChange と併せて指定するとフィルターは「サーバー駆動（制御）」モードになる。
   */
  selectedStatus?: FilterStatus;
  /**
   * ステータスフィルター変更コールバック。
   * 指定時はタブ選択がこのコールバックを呼ぶだけで、コンポーネント内ではフィルターしない（制御モード）。
   * 省略時はコンポーネント内の state でローカルフィルターする（非制御フォールバック: assigned/joinable 用）。
   */
  onStatusChange?: (status: FilterStatus) => void;
  /**
   * サーバーが返すページネーション情報。
   * 指定時はこの prop からページ UI を描画する（制御モード）。
   * 省略時はページ UI を表示しない（assigned/joinable は小さなリストのため）。
   */
  pagination?: PaginationInfo;
  /** ページ変更コールバック（制御モードのページ UI から呼ばれる） */
  onPageChange?: (page: number) => void;
}

const STATUS_LABEL_KEYS: Record<ReviewSessionStatus, string> = {
  PENDING: 'sessionList.status.pending',
  IN_PROGRESS: 'sessionList.status.inProgress',
  COMPLETED: 'sessionList.status.completed',
};

const FILTER_OPTIONS: { value: FilterStatus; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'sessionList.filter.all' },
  { value: 'PENDING', labelKey: 'sessionList.filter.pending' },
  { value: 'IN_PROGRESS', labelKey: 'sessionList.filter.inProgress' },
  { value: 'COMPLETED', labelKey: 'sessionList.filter.completed' },
];

/**
 * SessionListPage - ReviewSession一覧画面
 *
 * プレゼンテーショナルコンポーネント。制御モード（server-driven）と
 * 非制御フォールバックモード（assigned/joinable）の2モードを props の有無で切り替える。
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 11.7
 */
export function SessionListPage({
  sessions,
  isLoading = false,
  error,
  onSessionSelect,
  title,
  renderSessionActions,
  onRenameSession,
  selectedStatus = 'ALL',
  onStatusChange,
  pagination,
  onPageChange,
}: SessionListPageProps) {
  const { t } = useTranslation('review');
  const resolvedTitle = title ?? t('sessionList.defaultTitle');
  // onStatusChange が渡された場合は制御（サーバー駆動）フィルターモード。
  const isControlledFilter = !!onStatusChange;
  const [localFilter, setLocalFilter] = useState<FilterStatus>('ALL');

  // 表示中のアクティブなフィルター: 制御モードでは selectedStatus、非制御ではローカル state。
  const activeFilter = isControlledFilter ? selectedStatus : localFilter;

  const handleFilterChange = (newFilter: FilterStatus) => {
    if (isControlledFilter) {
      onStatusChange?.(newFilter);
      return;
    }
    setLocalFilter(newFilter);
  };

  // 制御モードではサーバーが既にフィルター＋降順ソート＋ページング済みのため、
  // 受け取った sessions をそのまま描画する（クライアント再ソート／再フィルターしない）。
  // 非制御フォールバックモードではローカルでフィルター＋降順ソートする。
  const displayedSessions = useMemo(() => {
    if (isControlledFilter) {
      return sessions;
    }
    const filtered =
      localFilter === 'ALL'
        ? sessions
        : sessions.filter((s) => s.status === localFilter);
    return [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [sessions, isControlledFilter, localFilter]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-64"
        role="status"
        aria-label={t('sessionList.loadingAriaLabel')}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">{t('sessionList.loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center h-64"
        role="alert"
      >
        <p className="text-red-600">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" role="main" aria-label={resolvedTitle}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">{resolvedTitle}</h1>
      </div>

      {/* Filter tabs */}
      <div
        className="flex gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50"
        role="tablist"
        aria-label={t('sessionList.statusFilterAriaLabel')}
      >
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={activeFilter === option.value}
            onClick={() => handleFilterChange(option.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              activeFilter === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
            }`}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-auto px-4 py-3" role="tabpanel">
        {displayedSessions.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-gray-500">{t('sessionList.emptyState')}</p>
          </div>
        ) : (
          <>
            <ul className="space-y-2" aria-label={t('sessionList.listAriaLabel')}>
              {displayedSessions.map((session) => (
                <li
                  key={session.sessionId}
                  className="px-4 py-3 bg-white border border-gray-200 rounded-lg"
                >
                  {/* onRenameSession 指定時は編集 UI が名前を表示するため、
                      選択ボタン内の名前は重複表示を避けて非表示にする（aria-label には残す）。 */}
                  {onRenameSession && (
                    <SessionNameEditor
                      name={session.name}
                      onSave={(n) => onRenameSession(session.sessionId, n)}
                      className="mb-2"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onSessionSelect?.(session.sessionId)}
                    className="w-full text-left rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    aria-label={t('sessionList.openReviewAriaLabel', {
                      name: session.name,
                      status: t(STATUS_LABEL_KEYS[session.status]),
                    })}
                  >
                    <div className="flex items-center justify-between">
                      {onRenameSession ? (
                        <span className="text-sm text-blue-600">{t('sessionList.openReview')}</span>
                      ) : (
                        <span className="font-medium text-gray-900">
                          {session.name}
                        </span>
                      )}
                      <StatusBadge status={session.status} t={t} />
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      <time dateTime={session.createdAt}>
                        {formatSessionDate(session.createdAt)}
                      </time>
                    </div>
                  </button>
                  {renderSessionActions?.(session)}
                </li>
              ))}
            </ul>

            {/* Pagination (server-driven; rendered only when pagination prop has >1 page) */}
            {pagination && pagination.totalPages > 1 && (
              <nav
                className="flex items-center justify-between px-2 py-3 mt-4 border-t border-gray-200"
                aria-label={t('sessionList.paginationAriaLabel')}
              >
                <p className="text-sm text-gray-600">
                  {t('sessionList.itemRange', {
                    totalItems: pagination.totalItems,
                    start: (pagination.currentPage - 1) * pagination.pageSize + 1,
                    end: Math.min(
                      pagination.currentPage * pagination.pageSize,
                      pagination.totalItems
                    ),
                  })}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onPageChange?.(pagination.currentPage - 1)}
                    disabled={!pagination.hasPreviousPage}
                    className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                    aria-label={t('sessionList.previousAriaLabel')}
                  >
                    {t('sessionList.previous')}
                  </button>
                  <span className="flex items-center px-2 text-sm text-gray-600">
                    {pagination.currentPage} / {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPageChange?.(pagination.currentPage + 1)}
                    disabled={!pagination.hasNextPage}
                    className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                    aria-label={t('sessionList.nextAriaLabel')}
                  >
                    {t('sessionList.next')}
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: ReviewSessionStatus; t: TFunction }) {
  const colorClasses: Record<ReviewSessionStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${colorClasses[status]}`}
    >
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  );
}
