import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SessionListPage } from './SessionListPage';
import type { PaginationInfo } from './SessionListPage';
import { formatSessionDate } from '../utils/session-format';
import type { ReviewSession } from '../types/session';

function createSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    sessionId: 'session-1',
    transcriptionJobId: 'job-1',
    name: 'テストセッション',
    status: 'PENDING',
    assignedReviewerCount: 3,
    consensusThreshold: 70,
    partialAggregationEnabled: false,
    createdAt: '2024-06-15T10:30:00.000Z',
    updatedAt: '2024-06-15T10:30:00.000Z',
    ...overrides,
  };
}

/**
 * createManySessions - sessions prop に流し込む配列を生成するヘルパー。
 * サーバーが降順ソート済みで返す前提に合わせ、createdAt は降順（先頭が最新）で並ぶ。
 */
function createManySessions(count: number): ReviewSession[] {
  return Array.from({ length: count }, (_, i) =>
    createSession({
      sessionId: `s-${i}`,
      name: `セッション${i + 1}`,
      createdAt: new Date(2024, 0, 1, 0, 0, 0, count - i).toISOString(),
    })
  );
}

function createPagination(overrides: Partial<PaginationInfo> = {}): PaginationInfo {
  return {
    currentPage: 1,
    pageSize: 50,
    totalItems: 75,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
    ...overrides,
  };
}

describe('formatSessionDate', () => {
  it('formats ISO string to YYYY-MM-DD HH:MM in local time', () => {
    // Use a fixed date to avoid timezone issues in tests
    const date = new Date(2024, 5, 15, 14, 30); // June 15, 2024 14:30 local
    const result = formatSessionDate(date.toISOString());
    expect(result).toBe('2024-06-15 14:30');
  });

  it('pads single-digit month, day, hours, and minutes with zeros', () => {
    const date = new Date(2024, 0, 5, 3, 7); // Jan 5, 2024 03:07 local
    const result = formatSessionDate(date.toISOString());
    expect(result).toBe('2024-01-05 03:07');
  });

  it('returns format matching YYYY-MM-DD HH:MM pattern', () => {
    const result = formatSessionDate('2024-12-31T23:59:00.000Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('SessionListPage', () => {
  it('renders loading state', () => {
    render(<SessionListPage sessions={[]} isLoading={true} />);

    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });

  it('renders error state with message', () => {
    render(
      <SessionListPage
        sessions={[]}
        error={{ message: 'データの取得に失敗しました' }}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('データの取得に失敗しました')).toBeInTheDocument();
  });

  it('renders empty state message when no sessions', () => {
    render(<SessionListPage sessions={[]} />);

    expect(screen.getByText('校閲セッションがありません')).toBeInTheDocument();
  });

  it('renders session list with name, status, and date', () => {
    const sessions = [
      createSession({
        sessionId: 's1',
        name: '会議録A',
        status: 'IN_PROGRESS',
        createdAt: new Date(2024, 5, 15, 14, 30).toISOString(),
      }),
    ];

    render(<SessionListPage sessions={sessions} />);

    expect(screen.getByText('会議録A')).toBeInTheDocument();
    // The status badge inside the session item
    const sessionButton = screen.getByRole('button', { name: '会議録A - 進行中' });
    expect(sessionButton).toBeInTheDocument();
    expect(screen.getByText('2024-06-15 14:30')).toBeInTheDocument();
  });

  it('renders sessions in the given order without client re-sort (controlled mode)', () => {
    // Server returns sessions pre-sorted createdAt desc. The component must render
    // them exactly as provided and must NOT reorder.
    const sessions = [
      createSession({ sessionId: 's2', name: '新しいセッション', createdAt: '2024-06-15T00:00:00.000Z' }),
      createSession({ sessionId: 's3', name: '中間セッション', createdAt: '2024-03-10T00:00:00.000Z' }),
      createSession({ sessionId: 's1', name: '古いセッション', createdAt: '2024-01-01T00:00:00.000Z' }),
    ];

    render(
      <SessionListPage
        sessions={sessions}
        selectedStatus="ALL"
        onStatusChange={vi.fn()}
        pagination={createPagination({ totalItems: 3, totalPages: 1, hasNextPage: false })}
        onPageChange={vi.fn()}
      />
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('新しいセッション');
    expect(items[1]).toHaveTextContent('中間セッション');
    expect(items[2]).toHaveTextContent('古いセッション');
  });

  it('sorts sessions by createdAt descending in uncontrolled fallback mode', () => {
    const sessions = [
      createSession({ sessionId: 's1', name: '古いセッション', createdAt: '2024-01-01T00:00:00.000Z' }),
      createSession({ sessionId: 's2', name: '新しいセッション', createdAt: '2024-06-15T00:00:00.000Z' }),
      createSession({ sessionId: 's3', name: '中間セッション', createdAt: '2024-03-10T00:00:00.000Z' }),
    ];

    render(<SessionListPage sessions={sessions} />);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('新しいセッション');
    expect(items[1]).toHaveTextContent('中間セッション');
    expect(items[2]).toHaveTextContent('古いセッション');
  });

  it('calls onSessionSelect with sessionId when session is clicked', async () => {
    const user = userEvent.setup();
    const onSessionSelect = vi.fn();
    const sessions = [
      createSession({ sessionId: 'abc-123', name: 'テスト' }),
    ];

    render(
      <SessionListPage sessions={sessions} onSessionSelect={onSessionSelect} />
    );

    await user.click(screen.getByRole('button', { name: /テスト/ }));

    expect(onSessionSelect).toHaveBeenCalledWith('abc-123');
  });

  it('uses a custom title when provided', () => {
    render(<SessionListPage sessions={[]} title="自分の割り当てセッション" />);

    expect(
      screen.getByRole('main', { name: '自分の割り当てセッション' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '自分の割り当てセッション' })
    ).toBeInTheDocument();
  });

  it('renders custom session actions under each session', () => {
    const sessions = [createSession({ sessionId: 's1', name: 'アクション付き' })];

    render(
      <SessionListPage
        sessions={sessions}
        renderSessionActions={(s) => (
          <span data-testid={`action-${s.sessionId}`}>操作</span>
        )}
      />
    );

    expect(screen.getByTestId('action-s1')).toBeInTheDocument();
  });

  it('does not render session name editor when onRenameSession is omitted', () => {
    const sessions = [createSession({ sessionId: 's1', name: '編集なし' })];

    render(<SessionListPage sessions={sessions} />);

    expect(
      screen.queryByRole('button', { name: 'セッション名を編集' })
    ).not.toBeInTheDocument();
  });

  it('renders session name editor and calls onRenameSession with sessionId and trimmed name', async () => {
    const user = userEvent.setup();
    const onRenameSession = vi.fn().mockResolvedValue(null);
    const sessions = [createSession({ sessionId: 'rename-1', name: '旧名' })];

    render(
      <SessionListPage sessions={sessions} onRenameSession={onRenameSession} />
    );

    await user.click(screen.getByRole('button', { name: 'セッション名を編集' }));
    const input = screen.getByRole('textbox', { name: 'セッション名' });
    await user.clear(input);
    await user.type(input, '  新しい名前  ');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onRenameSession).toHaveBeenCalledWith('rename-1', '新しい名前');
  });

  describe('filtering (controlled / server-driven)', () => {
    const sessions = [
      createSession({ sessionId: 's1', name: '未着手A', status: 'PENDING' }),
      createSession({ sessionId: 's2', name: '進行中A', status: 'IN_PROGRESS' }),
      createSession({ sessionId: 's3', name: '完了A', status: 'COMPLETED' }),
      createSession({ sessionId: 's4', name: '未着手B', status: 'PENDING' }),
    ];

    it('calls onStatusChange with PENDING when 未着手 tab is clicked', async () => {
      const user = userEvent.setup();
      const onStatusChange = vi.fn();
      render(
        <SessionListPage sessions={sessions} selectedStatus="ALL" onStatusChange={onStatusChange} />
      );

      await user.click(screen.getByRole('tab', { name: '未着手' }));

      expect(onStatusChange).toHaveBeenCalledWith('PENDING');
    });

    it('calls onStatusChange with IN_PROGRESS when 進行中 tab is clicked', async () => {
      const user = userEvent.setup();
      const onStatusChange = vi.fn();
      render(
        <SessionListPage sessions={sessions} selectedStatus="ALL" onStatusChange={onStatusChange} />
      );

      await user.click(screen.getByRole('tab', { name: '進行中' }));

      expect(onStatusChange).toHaveBeenCalledWith('IN_PROGRESS');
    });

    it('calls onStatusChange with COMPLETED when 完了 tab is clicked', async () => {
      const user = userEvent.setup();
      const onStatusChange = vi.fn();
      render(
        <SessionListPage sessions={sessions} selectedStatus="ALL" onStatusChange={onStatusChange} />
      );

      await user.click(screen.getByRole('tab', { name: '完了' }));

      expect(onStatusChange).toHaveBeenCalledWith('COMPLETED');
    });

    it('calls onStatusChange with ALL when 全て tab is clicked', async () => {
      const user = userEvent.setup();
      const onStatusChange = vi.fn();
      render(
        <SessionListPage sessions={sessions} selectedStatus="PENDING" onStatusChange={onStatusChange} />
      );

      await user.click(screen.getByRole('tab', { name: '全て' }));

      expect(onStatusChange).toHaveBeenCalledWith('ALL');
    });

    it('reflects selectedStatus via aria-selected and does NOT filter locally', () => {
      render(
        <SessionListPage sessions={sessions} selectedStatus="IN_PROGRESS" onStatusChange={vi.fn()} />
      );

      expect(screen.getByRole('tab', { name: '進行中' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: '全て' })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tab', { name: '未着手' })).toHaveAttribute('aria-selected', 'false');

      // All passed sessions remain rendered: the component does not filter in controlled mode
      // (the server already filtered). The input array is rendered verbatim.
      expect(screen.getByText('未着手A')).toBeInTheDocument();
      expect(screen.getByText('進行中A')).toBeInTheDocument();
      expect(screen.getByText('完了A')).toBeInTheDocument();
      expect(screen.getByText('未着手B')).toBeInTheDocument();
    });
  });

  describe('filtering (uncontrolled fallback — assigned/joinable)', () => {
    const sessions = [
      createSession({ sessionId: 's1', name: '未着手A', status: 'PENDING' }),
      createSession({ sessionId: 's2', name: '進行中A', status: 'IN_PROGRESS' }),
      createSession({ sessionId: 's3', name: '完了A', status: 'COMPLETED' }),
      createSession({ sessionId: 's4', name: '未着手B', status: 'PENDING' }),
    ];

    it('shows all sessions by default (全て filter)', () => {
      render(<SessionListPage sessions={sessions} />);

      expect(screen.getByText('未着手A')).toBeInTheDocument();
      expect(screen.getByText('進行中A')).toBeInTheDocument();
      expect(screen.getByText('完了A')).toBeInTheDocument();
      expect(screen.getByText('未着手B')).toBeInTheDocument();
    });

    it('filters by PENDING status locally', async () => {
      const user = userEvent.setup();
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('tab', { name: '未着手' }));

      expect(screen.getByText('未着手A')).toBeInTheDocument();
      expect(screen.getByText('未着手B')).toBeInTheDocument();
      expect(screen.queryByText('進行中A')).not.toBeInTheDocument();
      expect(screen.queryByText('完了A')).not.toBeInTheDocument();
    });

    it('filters by IN_PROGRESS status locally', async () => {
      const user = userEvent.setup();
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('tab', { name: '進行中' }));

      expect(screen.getByText('進行中A')).toBeInTheDocument();
      expect(screen.queryByText('未着手A')).not.toBeInTheDocument();
      expect(screen.queryByText('完了A')).not.toBeInTheDocument();
    });

    it('filters by COMPLETED status locally', async () => {
      const user = userEvent.setup();
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('tab', { name: '完了' }));

      expect(screen.getByText('完了A')).toBeInTheDocument();
      expect(screen.queryByText('未着手A')).not.toBeInTheDocument();
      expect(screen.queryByText('進行中A')).not.toBeInTheDocument();
    });

    it('shows empty message when local filter matches no sessions', async () => {
      const user = userEvent.setup();
      const pendingOnly = [
        createSession({ sessionId: 's1', name: '未着手のみ', status: 'PENDING' }),
      ];

      render(<SessionListPage sessions={pendingOnly} />);

      await user.click(screen.getByRole('tab', { name: '完了' }));

      expect(screen.getByText('校閲セッションがありません')).toBeInTheDocument();
    });

    it('marks active filter tab with aria-selected (local state)', async () => {
      const user = userEvent.setup();
      render(<SessionListPage sessions={sessions} />);

      const allTab = screen.getByRole('tab', { name: '全て' });
      expect(allTab).toHaveAttribute('aria-selected', 'true');

      await user.click(screen.getByRole('tab', { name: '進行中' }));

      expect(allTab).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tab', { name: '進行中' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('does not render pagination nav when pagination prop is omitted', () => {
      render(<SessionListPage sessions={sessions} />);

      expect(
        screen.queryByRole('navigation', { name: 'ページネーション' })
      ).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA landmarks', () => {
      render(<SessionListPage sessions={[]} />);

      expect(
        screen.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('tablist', { name: 'ステータスフィルター' })
      ).toBeInTheDocument();
    });

    it('session buttons have descriptive aria-labels', () => {
      const sessions = [
        createSession({ sessionId: 's1', name: '会議録', status: 'IN_PROGRESS' }),
      ];

      render(<SessionListPage sessions={sessions} />);

      expect(
        screen.getByRole('button', { name: '会議録 - 進行中' })
      ).toBeInTheDocument();
    });

    it('has no accessibility violations with the session name editor (WCAG 2.1 AA)', async () => {
      const sessions = [
        createSession({ sessionId: 's1', name: '会議録', status: 'IN_PROGRESS' }),
      ];

      const { container } = render(
        <SessionListPage
          sessions={sessions}
          onRenameSession={vi.fn().mockResolvedValue(null)}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations in controlled mode with pagination (WCAG 2.1 AA)', async () => {
      const sessions = createManySessions(50);

      const { container } = render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ totalItems: 75, totalPages: 2, hasNextPage: true })}
          onPageChange={vi.fn()}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('pagination (controlled / server-driven)', () => {
    it('does not show pagination when pagination has a single page', () => {
      const sessions = createManySessions(50);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ totalItems: 50, totalPages: 1, hasNextPage: false })}
          onPageChange={vi.fn()}
        />
      );

      expect(
        screen.queryByRole('navigation', { name: 'ページネーション' })
      ).not.toBeInTheDocument();
    });

    it('shows pagination when pagination has more than one page', () => {
      const sessions = createManySessions(50);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ totalItems: 75, totalPages: 2, hasNextPage: true })}
          onPageChange={vi.fn()}
        />
      );

      expect(
        screen.getByRole('navigation', { name: 'ページネーション' })
      ).toBeInTheDocument();
    });

    it('renders exactly the sessions it is given (server already sliced)', () => {
      // Server returned 50 items for page 1 of a 75-item set. The component renders
      // all 50 as-is and does NOT slice.
      const sessions = createManySessions(50);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ totalItems: 75, totalPages: 2, hasNextPage: true })}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getAllByRole('listitem')).toHaveLength(50);
    });

    it('calls onPageChange with next page when 次のページ is clicked', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      const sessions = createManySessions(50);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ currentPage: 1, totalItems: 75, totalPages: 2, hasNextPage: true, hasPreviousPage: false })}
          onPageChange={onPageChange}
        />
      );

      await user.click(screen.getByRole('button', { name: '次のページ' }));

      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('calls onPageChange with previous page when 前のページ is clicked', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      const sessions = createManySessions(25);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ currentPage: 2, totalItems: 75, totalPages: 2, hasNextPage: false, hasPreviousPage: true })}
          onPageChange={onPageChange}
        />
      );

      await user.click(screen.getByRole('button', { name: '前のページ' }));

      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('disables prev button when hasPreviousPage is false', () => {
      const sessions = createManySessions(50);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ currentPage: 1, totalPages: 2, hasPreviousPage: false, hasNextPage: true })}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: '前のページ' })).toBeDisabled();
    });

    it('disables next button when hasNextPage is false', () => {
      const sessions = createManySessions(25);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ currentPage: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true })}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: '次のページ' })).toBeDisabled();
    });

    it('displays page info text derived from the pagination prop', () => {
      const sessions = createManySessions(50);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ currentPage: 1, pageSize: 50, totalItems: 75, totalPages: 2, hasNextPage: true, hasPreviousPage: false })}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByText(/75件中/)).toBeInTheDocument();
      expect(screen.getByText(/1〜50件を表示/)).toBeInTheDocument();
    });

    it('displays current page / total pages from the pagination prop', () => {
      const sessions = createManySessions(50);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ currentPage: 1, totalPages: 2 })}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByText('1 / 2')).toBeInTheDocument();
    });

    it('reflects page 2 info from the pagination prop', () => {
      const sessions = createManySessions(25);
      render(
        <SessionListPage
          sessions={sessions}
          selectedStatus="ALL"
          onStatusChange={vi.fn()}
          pagination={createPagination({ currentPage: 2, pageSize: 50, totalItems: 75, totalPages: 2, hasNextPage: false, hasPreviousPage: true })}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByText('2 / 2')).toBeInTheDocument();
      expect(screen.getByText(/51〜75件を表示/)).toBeInTheDocument();
    });
  });

  describe('date formatting edge cases', () => {
    it('displays midnight time as 00:00', () => {
      const sessions = [
        createSession({
          sessionId: 's1',
          name: '深夜セッション',
          createdAt: new Date(2024, 11, 25, 0, 0).toISOString(),
        }),
      ];

      render(<SessionListPage sessions={sessions} />);

      expect(screen.getByText('2024-12-25 00:00')).toBeInTheDocument();
    });

    it('displays end-of-day time correctly', () => {
      const sessions = [
        createSession({
          sessionId: 's1',
          name: '年末セッション',
          createdAt: new Date(2024, 11, 31, 23, 59).toISOString(),
        }),
      ];

      render(<SessionListPage sessions={sessions} />);

      expect(screen.getByText('2024-12-31 23:59')).toBeInTheDocument();
    });
  });
});
