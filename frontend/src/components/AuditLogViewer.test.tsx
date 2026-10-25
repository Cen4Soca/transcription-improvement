import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogViewer } from './AuditLogViewer';
import type { AuditLog } from '../types/audit';

const sampleLogs: AuditLog[] = [
  {
    logId: 'log-001',
    createdAt: '2024-01-15T10:00:00.000Z',
    actorUserId: 'admin-001',
    actorRole: 'ADMIN',
    operationType: 'USER_MANAGEMENT',
    resourceId: 'user-123',
    resourceType: 'User',
  },
  {
    logId: 'log-002',
    createdAt: '2024-01-14T09:00:00.000Z',
    actorUserId: 'admin-001',
    actorRole: 'ADMIN',
    operationType: 'IP_ALLOWLIST_CHANGE',
    resourceId: 'entry-456',
    resourceType: 'IPAllowlistEntry',
  },
  {
    logId: 'log-003',
    createdAt: '2024-01-13T08:00:00.000Z',
    actorUserId: 'admin-001',
    actorRole: 'ADMIN',
    operationType: 'AUDIT_LOG_DELETED',
    resourceId: 'audit-logs',
    resourceType: 'AuditLog',
    metadata: { count: '5', reason: 'Deleted 5 entries' },
  },
];

describe('AuditLogViewer', () => {
  describe('削除確認ダイアログ (Requirement 14.13)', () => {
    it('削除ボタンクリックで確認ダイアログを表示する', async () => {
      const user = userEvent.setup();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
        />
      );

      await user.click(screen.getByText('フィルタ条件で削除'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('監査ログ削除の確認')).toBeInTheDocument();
    });

    it('確認ダイアログに削除対象件数を表示する', async () => {
      const user = userEvent.setup();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={150}
          currentPage={1}
        />
      );

      await user.click(screen.getByText('フィルタ条件で削除'));

      expect(screen.getByText(/150件.*削除します/)).toBeInTheDocument();
    });

    it('確認ダイアログに不可逆性の警告を表示する', async () => {
      const user = userEvent.setup();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
        />
      );

      await user.click(screen.getByText('フィルタ条件で削除'));

      expect(screen.getByText('この操作は取り消せません。')).toBeInTheDocument();
    });

    it('確定ボタンクリックでonDeleteLogsコールバックを呼び出す', async () => {
      const user = userEvent.setup();
      const onDeleteLogs = vi.fn();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
          onDeleteLogs={onDeleteLogs}
        />
      );

      await user.click(screen.getByText('フィルタ条件で削除'));
      await user.click(screen.getByText('削除する'));

      expect(onDeleteLogs).toHaveBeenCalledTimes(1);
    });

    it('キャンセルボタンクリックでダイアログを閉じ、削除を実行しない', async () => {
      const user = userEvent.setup();
      const onDeleteLogs = vi.fn();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
          onDeleteLogs={onDeleteLogs}
        />
      );

      await user.click(screen.getByText('フィルタ条件で削除'));
      await user.click(screen.getByText('キャンセル'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onDeleteLogs).not.toHaveBeenCalled();
    });

    it('ログ0件時は削除ボタンが無効化される', () => {
      render(
        <AuditLogViewer
          logs={[]}
          totalCount={0}
          currentPage={1}
        />
      );

      const deleteButton = screen.getByText('フィルタ条件で削除');
      expect(deleteButton).toBeDisabled();
    });
  });

  describe('フィルタリング (Requirement 14.11)', () => {
    it('操作種別フィルタ変更でonFilterChangeを呼び出す', async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
          onFilterChange={onFilterChange}
        />
      );

      await user.selectOptions(screen.getByLabelText('操作種別'), 'USER_MANAGEMENT');

      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ operationType: 'USER_MANAGEMENT' })
      );
    });

    it('実行者名フィルタ変更でonFilterChangeを呼び出す', async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
          onFilterChange={onFilterChange}
        />
      );

      await user.type(screen.getByLabelText('実行者名'), '山田太郎');

      expect(onFilterChange).toHaveBeenCalled();
      const lastCall = onFilterChange.mock.calls[onFilterChange.mock.calls.length - 1][0];
      expect(lastCall.actorName).toBe('山田太郎');
    });

    it('actorNamesマップがある場合、実行者列に表示名を表示する', () => {
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
          actorNames={{ 'admin-001': '管理者 太郎' }}
        />
      );

      expect(screen.getAllByText('管理者 太郎').length).toBeGreaterThan(0);
    });

    it('検索ボタンクリックでonFilterChangeを呼び出す', async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
          onFilterChange={onFilterChange}
        />
      );

      await user.click(screen.getByText('検索'));

      expect(onFilterChange).toHaveBeenCalled();
    });

    it('該当ログ0件時に「該当する監査ログがありません」を表示する', () => {
      render(
        <AuditLogViewer
          logs={[]}
          totalCount={0}
          currentPage={1}
        />
      );

      expect(screen.getByText('該当する監査ログがありません')).toBeInTheDocument();
    });
  });

  describe('ページネーション (Requirement 14.11)', () => {
    it('複数ページ時にページネーションUIを表示する', () => {
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={250}
          currentPage={1}
        />
      );

      expect(screen.getByLabelText('ページネーション')).toBeInTheDocument();
      expect(screen.getByText('1 / 3 ページ')).toBeInTheDocument();
    });

    it('次へボタンクリックでonPageChangeを呼び出す', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={250}
          currentPage={1}
          onPageChange={onPageChange}
        />
      );

      await user.click(screen.getByLabelText('次へ（次のページ）'));

      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('前へボタンクリックでonPageChangeを呼び出す', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={250}
          currentPage={2}
          onPageChange={onPageChange}
        />
      );

      await user.click(screen.getByLabelText('前へ（前のページ）'));

      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('最初のページでは前へボタンが無効化される', () => {
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={250}
          currentPage={1}
        />
      );

      expect(screen.getByLabelText('前へ（前のページ）')).toBeDisabled();
    });

    it('最後のページでは次へボタンが無効化される', () => {
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={250}
          currentPage={3}
        />
      );

      expect(screen.getByLabelText('次へ（次のページ）')).toBeDisabled();
    });

    it('1ページ以下の場合はページネーションUIを非表示にする', () => {
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
        />
      );

      expect(screen.queryByLabelText('ページネーション')).not.toBeInTheDocument();
    });
  });

  describe('ログ表示', () => {
    it('監査ログの各フィールドをテーブルに表示する', () => {
      render(
        <AuditLogViewer
          logs={sampleLogs}
          totalCount={3}
          currentPage={1}
        />
      );

      expect(screen.getAllByText('admin-001').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('user-123')).toBeInTheDocument();
      expect(screen.getAllByText('管理者').length).toBeGreaterThanOrEqual(1);
    });

    it('ローディング中はスピナーを表示する', () => {
      render(
        <AuditLogViewer
          logs={[]}
          totalCount={0}
          currentPage={1}
          isLoading={true}
        />
      );

      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('AUDIT_LOG_DELETED操作種別のログを表示する', () => {
      const deletionLog: AuditLog[] = [
        {
          logId: 'log-del-001',
          createdAt: '2024-01-15T10:00:00.000Z',
          actorUserId: 'admin-001',
          actorRole: 'ADMIN',
          operationType: 'AUDIT_LOG_DELETED',
          resourceId: 'audit-logs',
          resourceType: 'AuditLog',
        },
      ];

      render(
        <AuditLogViewer
          logs={deletionLog}
          totalCount={1}
          currentPage={1}
        />
      );

      expect(screen.getByText('audit-logs')).toBeInTheDocument();
    });
  });
});
