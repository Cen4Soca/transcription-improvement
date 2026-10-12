import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RankingPage, type RankingEntry, type PaginationInfo } from './RankingPage';

function createRankingEntry(overrides: Partial<RankingEntry> = {}): RankingEntry {
  return {
    rank: 1,
    userId: 'user-1',
    displayName: 'テストユーザー',
    answerCount: 50,
    accuracyRate: 80.0,
    score: 40.0,
    ...overrides,
  };
}

const sampleRankings: RankingEntry[] = [
  createRankingEntry({ rank: 1, userId: 'user-a', displayName: 'Alice', answerCount: 100, accuracyRate: 85.5, score: 85.5 }),
  createRankingEntry({ rank: 2, userId: 'user-b', displayName: 'Bob', answerCount: 50, accuracyRate: 80.0, score: 40.0 }),
  createRankingEntry({ rank: 3, userId: 'user-c', displayName: 'Charlie', answerCount: 10, accuracyRate: 70.0, score: 7.0 }),
];

describe('RankingPage', () => {
  it('renders loading state', () => {
    render(
      <RankingPage
        rankings={[]}
        currentUser={null}
        currentUserId="user-1"
        isLoading={true}
      />
    );

    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });

  it('renders error state with message', () => {
    render(
      <RankingPage
        rankings={[]}
        currentUser={null}
        currentUserId="user-1"
        error={{ message: 'ランキングの取得に失敗しました' }}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('ランキングの取得に失敗しました')).toBeInTheDocument();
  });

  it('renders empty state message when no rankings', () => {
    render(
      <RankingPage
        rankings={[]}
        currentUser={null}
        currentUserId="user-1"
      />
    );

    expect(screen.getByText('まだランキングデータがありません')).toBeInTheDocument();
  });

  it('renders ranking table with rank, displayName, answerCount, accuracyRate, score', () => {
    render(
      <RankingPage
        rankings={sampleRankings}
        currentUser={sampleRankings[1]}
        currentUserId="user-b"
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('85.5%')).toBeInTheDocument();
    expect(screen.getByText('80.0%')).toBeInTheDocument();
    expect(screen.getByText('70.0%')).toBeInTheDocument();
  });

  it('highlights current user row (Req 12.7)', () => {
    render(
      <RankingPage
        rankings={sampleRankings}
        currentUser={sampleRankings[1]}
        currentUserId="user-b"
      />
    );

    // The current user's row should have aria-current and the "あなた" badge
    const currentRow = screen.getByText('あなた').closest('tr');
    expect(currentRow).toHaveAttribute('aria-current', 'true');
    expect(currentRow).toHaveClass('bg-blue-50');
  });

  it('shows current user at bottom when outside rankings (Req 12.8)', () => {
    const outsideUser: RankingEntry = createRankingEntry({
      rank: 42,
      userId: 'user-x',
      displayName: 'Xavier',
      answerCount: 5,
      accuracyRate: 40.0,
      score: 2.0,
    });

    render(
      <RankingPage
        rankings={sampleRankings}
        currentUser={outsideUser}
        currentUserId="user-x"
      />
    );

    // Xavier should appear in the table
    expect(screen.getByText('Xavier')).toBeInTheDocument();
    expect(screen.getByText('あなた')).toBeInTheDocument();

    // The separator should be visible
    expect(screen.getByText('···')).toBeInTheDocument();

    // Xavier's row should be highlighted
    const xavierRow = screen.getByText('Xavier').closest('tr');
    expect(xavierRow).toHaveAttribute('aria-current', 'true');
  });

  it('does not show separator when current user is in rankings', () => {
    render(
      <RankingPage
        rankings={sampleRankings}
        currentUser={sampleRankings[0]}
        currentUserId="user-a"
      />
    );

    expect(screen.queryByText('···')).not.toBeInTheDocument();
  });

  describe('period filter (Req 12.5)', () => {
    it('renders all period filter tabs', () => {
      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
        />
      );

      expect(screen.getByRole('tab', { name: '全期間' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: '今月' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: '今年' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: '直近30日' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: '直近90日' })).toBeInTheDocument();
    });

    it('defaults to 全期間 (ALL) selected', () => {
      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
        />
      );

      expect(screen.getByRole('tab', { name: '全期間' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('calls onPeriodChange when a period tab is clicked', async () => {
      const user = userEvent.setup();
      const onPeriodChange = vi.fn();

      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
          onPeriodChange={onPeriodChange}
        />
      );

      await user.click(screen.getByRole('tab', { name: '今月' }));

      expect(onPeriodChange).toHaveBeenCalledWith('THIS_MONTH');
    });

    it('updates active tab on click', async () => {
      const user = userEvent.setup();

      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
        />
      );

      await user.click(screen.getByRole('tab', { name: '直近30日' }));

      expect(screen.getByRole('tab', { name: '直近30日' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByRole('tab', { name: '全期間' })).toHaveAttribute(
        'aria-selected',
        'false'
      );
    });
  });

  describe('pagination (Req 11.7)', () => {
    const paginationMultiPage: PaginationInfo = {
      currentPage: 2,
      pageSize: 50,
      totalItems: 120,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    };

    it('renders pagination controls when totalPages > 1', () => {
      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
          pagination={paginationMultiPage}
        />
      );

      expect(screen.getByRole('navigation', { name: 'ページネーション' })).toBeInTheDocument();
      expect(screen.getByLabelText('前のページ')).toBeInTheDocument();
      expect(screen.getByLabelText('次のページ')).toBeInTheDocument();
      expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    it('does not render pagination when totalPages is 1', () => {
      const singlePage: PaginationInfo = {
        currentPage: 1,
        pageSize: 50,
        totalItems: 3,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      };

      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
          pagination={singlePage}
        />
      );

      expect(screen.queryByRole('navigation', { name: 'ページネーション' })).not.toBeInTheDocument();
    });

    it('disables previous button on first page', () => {
      const firstPage: PaginationInfo = {
        currentPage: 1,
        pageSize: 50,
        totalItems: 120,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
      };

      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
          pagination={firstPage}
        />
      );

      expect(screen.getByLabelText('前のページ')).toBeDisabled();
      expect(screen.getByLabelText('次のページ')).not.toBeDisabled();
    });

    it('disables next button on last page', () => {
      const lastPage: PaginationInfo = {
        currentPage: 3,
        pageSize: 50,
        totalItems: 120,
        totalPages: 3,
        hasNextPage: false,
        hasPreviousPage: true,
      };

      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
          pagination={lastPage}
        />
      );

      expect(screen.getByLabelText('前のページ')).not.toBeDisabled();
      expect(screen.getByLabelText('次のページ')).toBeDisabled();
    });

    it('calls onPageChange with correct page number', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();

      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
          pagination={paginationMultiPage}
          onPageChange={onPageChange}
        />
      );

      await user.click(screen.getByLabelText('次のページ'));
      expect(onPageChange).toHaveBeenCalledWith(3);

      await user.click(screen.getByLabelText('前のページ'));
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('displays item range text', () => {
      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
          pagination={paginationMultiPage}
        />
      );

      expect(screen.getByText(/120件中/)).toBeInTheDocument();
      expect(screen.getByText(/51〜100件表示/)).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA landmarks', () => {
      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
        />
      );

      expect(
        screen.getByRole('main', { name: 'コントリビューターランキング' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('tablist', { name: '期間フィルター' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('table', { name: 'ランキングテーブル' })
      ).toBeInTheDocument();
    });

    it('table has proper column headers', () => {
      render(
        <RankingPage
          rankings={sampleRankings}
          currentUser={null}
          currentUserId="user-1"
        />
      );

      expect(screen.getByRole('columnheader', { name: '順位' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'ユーザー名' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: '回答数' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: '正答率' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'スコア' })).toBeInTheDocument();
    });
  });
});
