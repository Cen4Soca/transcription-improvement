import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const OPERATION_TYPE_KEYS: AuditOperationType[] = [
  'IP_ALLOWLIST_CHANGE',
  'USER_MANAGEMENT',
  'TEAM_MANAGEMENT',
  'REVIEW_ASSIGNMENT_CHANGE',
  'TEAM_ASSIGNMENT_CHANGE',
  'SESSION_COMPLETED',
  'CONSENSUS_MANUAL_CONFIRM',
  'CORRECTION_CONFIRMED',
  'SPEAKER_LABEL_CHANGED',
  'LOGIN_FAILURE',
  'MEDIA_DELETED',
  'TRANSCRIPTION_DELETED',
  'PARTIAL_DELETION_FAILURE',
  'LANGUAGE_MODEL_CREATED',
  'AUDIT_LOG_DELETED',
];

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
  const { t } = useTranslation('admin');
  const operationTypeLabel = (type: string) =>
    t(`auditLog.operationType.${type}`, { defaultValue: type });
  const roleLabel = (role: string) => t(`auditLog.role.${role}`, { defaultValue: role });
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
        aria-label={t('auditLog.loadingAriaLabel')}
      >
        <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label={t('auditLog.managementAriaLabel')}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t('auditLog.heading')}</h2>
        <button
          type="button"
          onClick={() => setShowDeleteDialog(true)}
          disabled={totalCount === 0}
          className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('auditLog.deleteByFilter')}
        </button>
      </div>

      {/* Filter form */}
      <form
        onSubmit={handleSearch}
        className="p-4 bg-gray-50 border border-gray-200 rounded-lg"
        aria-label={t('auditLog.filterAriaLabel')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="audit-start-date" className="block text-sm font-medium text-gray-700">
              {t('auditLog.startDate')}
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
              {t('auditLog.endDate')}
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
              {t('auditLog.actorName')}
            </label>
            <input
              id="audit-actor"
              type="text"
              value={filters.actorName}
              onChange={(e) => handleFilterChange('actorName', e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={t('auditLog.actorNamePlaceholder')}
            />
          </div>
          <div>
            <label htmlFor="audit-operation" className="block text-sm font-medium text-gray-700">
              {t('auditLog.operationTypeLabel')}
            </label>
            <select
              id="audit-operation"
              value={filters.operationType}
              onChange={(e) => handleFilterChange('operationType', e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">{t('auditLog.all')}</option>
              {OPERATION_TYPE_KEYS.map((value) => (
                <option key={value} value={value}>
                  {operationTypeLabel(value)}
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
            {t('auditLog.search')}
          </button>
        </div>
      </form>

      {/* Results info */}
      <p className="text-sm text-gray-500">
        {t('auditLog.itemRange', {
          totalItems: totalCount,
          start: Math.min((currentPage - 1) * pageSize + 1, totalCount),
          end: Math.min(currentPage * pageSize, totalCount),
        })}
      </p>

      {/* Log table */}
      {logs.length === 0 ? (
        <p className="text-center text-gray-500 py-8">
          {t('auditLog.emptyState')}
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200" aria-label={t('auditLog.tableAriaLabel')}>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('auditLog.column.datetime')}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('auditLog.column.actor')}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('auditLog.column.role')}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('auditLog.column.operationType')}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('auditLog.column.resourceId')}
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
                    {roleLabel(log.actorRole)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                      {operationTypeLabel(log.operationType)}
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
        <nav className="flex items-center justify-center gap-2" aria-label={t('auditLog.paginationAriaLabel')}>
          <button
            type="button"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={t('auditLog.previousAriaLabel')}
          >
            {t('auditLog.previous')}
          </button>
          <span className="text-sm text-gray-700" aria-current="page">
            {t('auditLog.pageIndicator', { current: currentPage, total: totalPages })}
          </span>
          <button
            type="button"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={t('auditLog.nextAriaLabel')}
          >
            {t('auditLog.next')}
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
              {t('auditLog.deleteDialogTitle')}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {t('auditLog.deleteDialogDescription', { count: totalCount })}
            </p>
            <p className="mt-2 text-sm font-medium text-red-600">
              {t('auditLog.deleteDialogWarning')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteDialog(false)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {t('auditLog.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
