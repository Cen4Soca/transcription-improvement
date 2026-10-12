import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ReviewSession, ReviewSessionStatus } from '../types/session';
import type { AppError } from '../types/api';
import { SessionNameEditor } from '../components/SessionNameEditor';
import { formatSessionDate } from '../utils/session-format';

const PAGE_SIZE = 50;

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
}

type FilterStatus = 'ALL' | ReviewSessionStatus;

const STATUS_LABELS: Record<ReviewSessionStatus, string> = {
  PENDING: '未着手',
  IN_PROGRESS: '進行中',
  COMPLETED: '完了',
};

const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'ALL', label: '全て' },
  { value: 'PENDING', label: '未着手' },
  { value: 'IN_PROGRESS', label: '進行中' },
  { value: 'COMPLETED', label: '完了' },
];

/**
 * SessionListPage - ReviewSession一覧画面
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 11.7
 */
export function SessionListPage({
  sessions,
  isLoading = false,
  error,
  onSessionSelect,
  title = '校閲セッション一覧',
  renderSessionActions,
  onRenameSession,
}: SessionListPageProps) {
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  const filteredAndSortedSessions = useMemo(() => {
    const filtered =
      filter === 'ALL'
        ? sessions
        : sessions.filter((s) => s.status === filter);

    return [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [sessions, filter]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedSessions.length / PAGE_SIZE));

  // Reset to page 1 when filter changes and current page exceeds total
  const safePage = Math.min(currentPage, totalPages);

  const paginatedSessions = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredAndSortedSessions.slice(start, start + PAGE_SIZE);
  }, [filteredAndSortedSessions, safePage]);

  const handleFilterChange = (newFilter: FilterStatus) => {
    setFilter(newFilter);
    setCurrentPage(1);
  };

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-64"
        role="status"
        aria-label="読み込み中"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">読み込み中...</span>
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
    <div className="flex flex-col h-full" role="main" aria-label={title}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      </div>

      {/* Filter tabs */}
      <div
        className="flex gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50"
        role="tablist"
        aria-label="ステータスフィルター"
      >
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => handleFilterChange(option.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              filter === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-auto px-4 py-3" role="tabpanel">
        {filteredAndSortedSessions.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-gray-500">校閲セッションがありません</p>
          </div>
        ) : (
          <>
            <ul className="space-y-2" aria-label="セッション一覧">
              {paginatedSessions.map((session) => (
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
                    aria-label={`${session.name} - ${STATUS_LABELS[session.status]}`}
                  >
                    <div className="flex items-center justify-between">
                      {onRenameSession ? (
                        <span className="text-sm text-blue-600">校閲画面を開く</span>
                      ) : (
                        <span className="font-medium text-gray-900">
                          {session.name}
                        </span>
                      )}
                      <StatusBadge status={session.status} />
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

            {/* Pagination */}
            {totalPages > 1 && (
              <nav
                className="flex items-center justify-between px-2 py-3 mt-4 border-t border-gray-200"
                aria-label="ページネーション"
              >
                <p className="text-sm text-gray-600">
                  {filteredAndSortedSessions.length}件中{' '}
                  {(safePage - 1) * PAGE_SIZE + 1}〜
                  {Math.min(safePage * PAGE_SIZE, filteredAndSortedSessions.length)}件を表示
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(safePage - 1)}
                    disabled={safePage <= 1}
                    className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                    aria-label="前のページ"
                  >
                    前へ
                  </button>
                  <span className="flex items-center px-2 text-sm text-gray-600">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(safePage + 1)}
                    disabled={safePage >= totalPages}
                    className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                    aria-label="次のページ"
                  >
                    次へ
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

function StatusBadge({ status }: { status: ReviewSessionStatus }) {
  const colorClasses: Record<ReviewSessionStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${colorClasses[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
