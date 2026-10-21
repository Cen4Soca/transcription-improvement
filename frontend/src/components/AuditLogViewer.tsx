import { useState } from 'react';
import type { AuditLog, AuditOperationType } from '../types/audit';

export interface AuditLogFilters {
  startDate?: string;
  endDate?: string;
  /** 実行者名（displayName）での絞り込み。部分一致・大文字小文字無視。 */
  actorName?: string;
  operationType?: AuditOperationType | '';
}

export interface AuditLogViewerProps {
  logs: AuditLog[];
  totalCount: number;
  currentPage: number;
  pageSize?: number;
  isLoading?: boolean;
  /**
   * 実行者ID→表示名のマップ。テーブルの実行者列で名前を表示するために使う。
   * 対応する名前がない場合はIDをそのまま表示する。
   */
  actorNames?: Record<string, string>;
  onFilterChange?: (filters: AuditLogFilters) => void;
  onPageChange?: (page: number) => void;
  onDeleteLogs?: (filters: AuditLogFilters) => void;
}

const OPERATION_TYPE_LABELS: Record<AuditOperationType, string> = {
  IP_ALLOWLIST_CHANGE: 'IPアドレス許可リスト変更',
  USER_MANAGEMENT: 'ユーザー管理',
  TEAM_MANAGEMENT: 'チーム管理',
  REVIEW_ASSIGNMENT_CHANGE: 'レビュー割り当て変更',
  TEAM_ASSIGNMENT_CHANGE: 'チーム割り当て変更',
  SESSION_COMPLETED: 'セッション完了',
  CONSENSUS_MANUAL_CONFIRM: 'コンセンサス手動確定',
  CORRECTION_CONFIRMED: '修正確定',
  SPEAKER_LABEL_CHANGED: '話者ラベル変更',
  LOGIN_FAILURE: 'ログイン失敗',
  MEDIA_DELETED: 'メディア削除',
  TRANSCRIPTION_DELETED: 'Transcription削除',
  PARTIAL_DELETION_FAILURE: '部分削除失敗',
  LANGUAGE_MODEL_CREATED: '言語モデル作成',
  AUDIT_LOG_DELETED: '監査ログ削除',
};

const ROLE_LABELS: Record<string, string> = {
  REVIEWER: 'レビュアー',
  TEAM_LEADER: 'チームリーダー',
  ADMIN: '管理者',
};

/**
 * AuditLogViewer - 監査ログ閲覧・検索・削除コンポーネント
 *
 * Requirements: 14.11, 14.13
 */
export function AuditLogViewer({
  logs,
  totalCount,
  currentPage,
  pageSize = 100,
  isLoading = false,
  actorNames = {},
  onFilterChange,
  onPageChange,
  onDeleteLogs,
}: AuditLogViewerProps) {
  const [filters, setFilters] = useState<AuditLogFilters>({
    startDate: '',
    endDate: '',
    actorName: '',
    operationType: '',
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const handleFilterChange = (key: keyof AuditLogFilters, value: string) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange?.(newFilters);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onFilterChange?.(filters);
  };

  const handleDeleteConfirm = () => {
    onDeleteLogs?.(filters);
    setShowDeleteDialog(false);
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      onPageChange?.(page);
    }
  };

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-48"
        role="status"
        aria-label="読み込み中"
      >
        <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="監査ログ管理">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">監査ログ</h2>
        <button
          type="button"
          onClick={() => setShowDeleteDialog(true)}
          disabled={totalCount === 0}
          className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          フィルタ条件で削除
        </button>
      </div>

      {/* Filter form */}
      <form
        onSubmit={handleSearch}
        className="p-4 bg-gray-50 border border-gray-200 rounded-lg"
        aria-label="監査ログフィルタ"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="audit-start-date" className="block text-sm font-medium text-gray-700">
              開始日
            </label>
            <input
              id="audit-start-date"
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="audit-end-date" className="block text-sm font-medium text-gray-700">
              終了日
            </label>
            <input
              id="audit-end-date"
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="audit-actor" className="block text-sm font-medium text-gray-700">
              実行者名
            </label>
            <input
              id="audit-actor"
              type="text"
              value={filters.actorName}
              onChange={(e) => handleFilterChange('actorName', e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="実行者の名前"
            />
          </div>
          <div>
            <label htmlFor="audit-operation" className="block text-sm font-medium text-gray-700">
              操作種別
            </label>
            <select
              id="audit-operation"
              value={filters.operationType}
              onChange={(e) => handleFilterChange('operationType', e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">すべて</option>
              {Object.entries(OPERATION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            検索
          </button>
        </div>
      </form>

      {/* Results info */}
      <p className="text-sm text-gray-500">
        {totalCount}件中 {Math.min((currentPage - 1) * pageSize + 1, totalCount)}〜
        {Math.min(currentPage * pageSize, totalCount)}件を表示
      </p>

      {/* Log table */}
      {logs.length === 0 ? (
        <p className="text-center text-gray-500 py-8">
          該当する監査ログがありません
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200" aria-label="監査ログテーブル">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  日時
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  実行者
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  ロール
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  操作種別
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  リソースID
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {logs.map((log) => (
                <tr key={log.logId}>
                  <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString('ja-JP')}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {actorNames[log.actorUserId] || log.actorUserId}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {ROLE_LABELS[log.actorRole] || log.actorRole}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                      {OPERATION_TYPE_LABELS[log.operationType] || log.operationType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-500">
                    {log.resourceId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="ページネーション">
          <button
            type="button"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="前のページ"
          >
            前へ
          </button>
          <span className="text-sm text-gray-700" aria-current="page">
            {currentPage} / {totalPages} ページ
          </span>
          <button
            type="button"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="次のページ"
          >
            次へ
          </button>
        </nav>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-audit-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 id="delete-audit-dialog-title" className="text-lg font-semibold text-gray-900">
              監査ログ削除の確認
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              現在のフィルタ条件に一致する監査ログ（{totalCount}件）を削除します。
            </p>
            <p className="mt-2 text-sm font-medium text-red-600">
              この操作は取り消せません。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteDialog(false)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
