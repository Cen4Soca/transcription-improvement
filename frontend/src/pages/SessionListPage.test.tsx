import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SessionListPage } from './SessionListPage';
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

  it('sorts sessions by createdAt descending', () => {
    const sessions = [
      createSession({
        sessionId: 's1',
        name: '古いセッション',
        createdAt: '2024-01-01T00:00:00.000Z',
      }),
      createSession({
        sessionId: 's2',
        name: '新しいセッション',
        createdAt: '2024-06-15T00:00:00.000Z',
      }),
      createSession({
        sessionId: 's3',
        name: '中間セッション',
        createdAt: '2024-03-10T00:00:00.000Z',
      }),
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

  describe('filtering', () => {
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

    it('filters by PENDING status', async () => {
      const user = userEvent.setup();
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('tab', { name: '未着手' }));

      expect(screen.getByText('未着手A')).toBeInTheDocument();
      expect(screen.getByText('未着手B')).toBeInTheDocument();
      expect(screen.queryByText('進行中A')).not.toBeInTheDocument();
      expect(screen.queryByText('完了A')).not.toBeInTheDocument();
    });

    it('filters by IN_PROGRESS status', async () => {
      const user = userEvent.setup();
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('tab', { name: '進行中' }));

      expect(screen.getByText('進行中A')).toBeInTheDocument();
      expect(screen.queryByText('未着手A')).not.toBeInTheDocument();
      expect(screen.queryByText('完了A')).not.toBeInTheDocument();
    });

    it('filters by COMPLETED status', async () => {
      const user = userEvent.setup();
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('tab', { name: '完了' }));

      expect(screen.getByText('完了A')).toBeInTheDocument();
      expect(screen.queryByText('未着手A')).not.toBeInTheDocument();
      expect(screen.queryByText('進行中A')).not.toBeInTheDocument();
    });

    it('shows empty message when filter matches no sessions', async () => {
      const user = userEvent.setup();
      const pendingOnly = [
        createSession({ sessionId: 's1', name: '未着手のみ', status: 'PENDING' }),
      ];

      render(<SessionListPage sessions={pendingOnly} />);

      await user.click(screen.getByRole('tab', { name: '完了' }));

      expect(screen.getByText('校閲セッションがありません')).toBeInTheDocument();
    });

    it('marks active filter tab with aria-selected', async () => {
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
  });

  describe('pagination', () => {
    function createManySessions(count: number): ReviewSession[] {
      return Array.from({ length: count }, (_, i) =>
        createSession({
          sessionId: `s-${i}`,
          name: `セッション${i + 1}`,
          createdAt: new Date(2024, 0, 1, 0, 0, 0, count - i).toISOString(),
        })
      );
    }

    it('does not show pagination when sessions fit in one page (<=50)', () => {
      const sessions = createManySessions(50);
      render(<SessionListPage sessions={sessions} />);

      expect(screen.queryByRole('navigation', { name: 'ページネーション' })).not.toBeInTheDocument();
    });

    it('shows pagination when sessions exceed one page (>50)', () => {
      const sessions = createManySessions(51);
      render(<SessionListPage sessions={sessions} />);

      expect(screen.getByRole('navigation', { name: 'ページネーション' })).toBeInTheDocument();
    });

    it('shows first 50 sessions on page 1', () => {
      const sessions = createManySessions(75);
      render(<SessionListPage sessions={sessions} />);

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(50);
    });

    it('navigates to next page and shows remaining sessions', async () => {
      const user = userEvent.setup();
      const sessions = createManySessions(75);
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('button', { name: '次のページ' }));

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(25);
    });

    it('navigates back to previous page', async () => {
      const user = userEvent.setup();
      const sessions = createManySessions(75);
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('button', { name: '次のページ' }));
      await user.click(screen.getByRole('button', { name: '前のページ' }));

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(50);
    });

    it('disables prev button on first page', () => {
      const sessions = createManySessions(75);
      render(<SessionListPage sessions={sessions} />);

      expect(screen.getByRole('button', { name: '前のページ' })).toBeDisabled();
    });

    it('disables next button on last page', async () => {
      const user = userEvent.setup();
      const sessions = createManySessions(75);
      render(<SessionListPage sessions={sessions} />);

      await user.click(screen.getByRole('button', { name: '次のページ' }));

      expect(screen.getByRole('button', { name: '次のページ' })).toBeDisabled();
    });

    it('displays page info text', () => {
      const sessions = createManySessions(75);
      render(<SessionListPage sessions={sessions} />);

      expect(screen.getByText(/75件中/)).toBeInTheDocument();
      expect(screen.getByText(/1〜50件を表示/)).toBeInTheDocument();
    });

    it('displays current page / total pages', () => {
      const sessions = createManySessions(75);
      render(<SessionListPage sessions={sessions} />);

      expect(screen.getByText('1 / 2')).toBeInTheDocument();
    });

    it('resets to page 1 when filter changes', async () => {
      const user = userEvent.setup();
      const sessions = [
        ...createManySessions(60).map((s) => ({ ...s, status: 'PENDING' as const })),
        createSession({ sessionId: 'in-progress-1', name: '進行中セッション', status: 'IN_PROGRESS' }),
      ];
      render(<SessionListPage sessions={sessions} />);

      // Go to page 2
      await user.click(screen.getByRole('button', { name: '次のページ' }));
      expect(screen.getByText('2 / 2')).toBeInTheDocument();

      // Change filter - should reset to page 1
      await user.click(screen.getByRole('tab', { name: '未着手' }));

      expect(screen.getByText('1 / 2')).toBeInTheDocument();
    });

    it('paginates exactly 100 items into 2 full pages', async () => {
      const user = userEvent.setup();
      const sessions = createManySessions(100);
      render(<SessionListPage sessions={sessions} />);

      expect(screen.getAllByRole('listitem')).toHaveLength(50);
      expect(screen.getByText('1 / 2')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '次のページ' }));

      expect(screen.getAllByRole('listitem')).toHaveLength(50);
      expect(screen.getByText('2 / 2')).toBeInTheDocument();
    });

    it('applies pagination to filtered results only', async () => {
      const user = userEvent.setup();
      const sessions = [
        ...createManySessions(55).map((s) => ({ ...s, status: 'PENDING' as const })),
        ...createManySessions(10).map((s, i) => ({
          ...s,
          sessionId: `completed-${i}`,
          status: 'COMPLETED' as const,
        })),
      ];
      render(<SessionListPage sessions={sessions} />);

      // Filter to COMPLETED - should have only 10 items, no pagination
      await user.click(screen.getByRole('tab', { name: '完了' }));

      expect(screen.getAllByRole('listitem')).toHaveLength(10);
      expect(screen.queryByRole('navigation', { name: 'ページネーション' })).not.toBeInTheDocument();
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
