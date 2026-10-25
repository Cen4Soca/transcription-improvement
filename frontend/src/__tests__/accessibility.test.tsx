import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { checkA11y } from '../test-utils/axe-setup';
import { SessionListPage } from '../pages/SessionListPage';
import { RankingPage } from '../pages/RankingPage';
import { AdminPage } from '../pages/AdminPage';
import { MediaUploadPage } from '../pages/MediaUploadPage';
import { ReviewPage } from '../pages/ReviewPage';
import { SearchBar } from '../components/SearchBar';
import { MediaPlayer } from '../components/MediaPlayer';
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog';
import { Navigation } from '../components/Navigation';
import type { ReviewSession } from '../types/session';

// Mock useAuth for Navigation
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', role: 'ADMIN', displayName: 'Admin User', email: 'admin@test.com' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// Mock AuthContext for ReviewPage
vi.mock('../services/auth-context', () => ({
  AuthContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
    Consumer: ({ children }: { children: (value: unknown) => React.ReactNode }) => children(null),
  },
}));

const mockSessions: ReviewSession[] = [
  {
    sessionId: 'session-1',
    transcriptionJobId: 'job-1',
    name: 'テストセッション1',
    status: 'PENDING',
    assignedReviewerCount: 3,
    consensusThreshold: 70,
    partialAggregationEnabled: false,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    sessionId: 'session-2',
    transcriptionJobId: 'job-2',
    name: 'テストセッション2',
    status: 'IN_PROGRESS',
    assignedReviewerCount: 5,
    consensusThreshold: 80,
    partialAggregationEnabled: true,
    createdAt: '2024-01-14T09:00:00Z',
    updatedAt: '2024-01-14T12:00:00Z',
  },
];

describe('Accessibility: WCAG 2.1 AA Compliance', () => {
  describe('SessionListPage', () => {
    test('empty state has no accessibility violations', async () => {
      const { container } = render(
        <SessionListPage sessions={[]} />,
      );
      await checkA11y(container);
    });

    test('with sessions has no accessibility violations', async () => {
      const { container } = render(
        <SessionListPage sessions={mockSessions} onSessionSelect={vi.fn()} />,
      );
      await checkA11y(container);
    });

    test('loading state has no accessibility violations', async () => {
      const { container } = render(
        <SessionListPage sessions={[]} isLoading={true} />,
      );
      await checkA11y(container);
    });

    test('error state has no accessibility violations', async () => {
      const { container } = render(
        <SessionListPage sessions={[]} error={{ message: 'データ取得に失敗しました' }} />,
      );
      await checkA11y(container);
    });

    test('has proper ARIA landmarks and labels', () => {
      const { container } = render(
        <SessionListPage sessions={mockSessions} />,
      );

      const main = container.querySelector('[role="main"]');
      expect(main).toHaveAttribute('aria-label', '校閲セッション一覧');

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toHaveAttribute('aria-label', 'ステータスフィルター');

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(4);
      tabs.forEach((tab) => {
        expect(tab).toHaveAttribute('aria-selected');
      });
    });
  });

  describe('RankingPage', () => {
    test('empty state has no accessibility violations', async () => {
      const { container } = render(
        <RankingPage rankings={[]} currentUser={null} currentUserId="user-1" />,
      );
      await checkA11y(container);
    });

    test('with rankings has no accessibility violations', async () => {
      const rankings = [
        { rank: 1, userId: 'user-1', displayName: 'ユーザー1', answerCount: 100, accuracyRate: 95.5, score: 95.5 },
        { rank: 2, userId: 'user-2', displayName: 'ユーザー2', answerCount: 80, accuracyRate: 90.0, score: 72.0 },
      ];
      const { container } = render(
        <RankingPage rankings={rankings} currentUser={rankings[0]} currentUserId="user-1" />,
      );
      await checkA11y(container);
    });

    test('has proper table structure with scope attributes', () => {
      const rankings = [
        { rank: 1, userId: 'user-1', displayName: 'ユーザー1', answerCount: 100, accuracyRate: 95.5, score: 95.5 },
      ];
      const { container } = render(
        <RankingPage rankings={rankings} currentUser={null} currentUserId="user-1" />,
      );

      const table = container.querySelector('table');
      expect(table).toHaveAttribute('aria-label', 'ランキングテーブル');

      const headers = container.querySelectorAll('th[scope="col"]');
      expect(headers.length).toBe(5);
    });
  });

  describe('AdminPage', () => {
    test('has no accessibility violations', async () => {
      const { container } = render(
        <AdminPage
          users={[]}
          teams={[]}
          sessions={[]}
          teamMembers={{}}
          teamAssignments={[]}
        />,
      );
      await checkA11y(container);
    });

    test('has proper tab navigation with ARIA attributes', () => {
      const { container } = render(
        <AdminPage
          users={[]}
          teams={[]}
          sessions={[]}
          teamMembers={{}}
          teamAssignments={[]}
        />,
      );

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toHaveAttribute('aria-label', '管理画面タブ');

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(4);

      // First tab should be selected
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[0]).toHaveAttribute('aria-controls');

      const tabpanel = container.querySelector('[role="tabpanel"]');
      expect(tabpanel).toHaveAttribute('aria-labelledby');
    });
  });

  describe('ReviewPage', () => {
    test('has no accessibility violations with empty segments', async () => {
      const { container } = render(
        <ReviewPage segments={[]} mediaUrl={null} />,
      );
      await checkA11y(container);
    });

    test('has proper ARIA landmarks', () => {
      const { container } = render(
        <ReviewPage segments={[]} mediaUrl={null} />,
      );

      const main = container.querySelector('[role="main"]');
      expect(main).toHaveAttribute('aria-label', '校閲画面');
    });
  });

  describe('MediaUploadPage', () => {
    test('has no accessibility violations', async () => {
      const mockApi = {
        getUploadUrl: vi.fn(),
        uploadFileToS3: vi.fn(),
        listMediaFiles: vi.fn(),
      } as unknown as Parameters<typeof MediaUploadPage>[0]['mediaApi'];

      const { container } = render(
        <MediaUploadPage mediaApi={mockApi} />,
      );
      await checkA11y(container);
    });

    test('has proper ARIA labels on interactive elements', () => {
      const mockApi = {
        getUploadUrl: vi.fn(),
        uploadFileToS3: vi.fn(),
        listMediaFiles: vi.fn(),
      } as unknown as Parameters<typeof MediaUploadPage>[0]['mediaApi'];

      const { container } = render(
        <MediaUploadPage mediaApi={mockApi} />,
      );

      const dropZone = container.querySelector('[role="button"]');
      expect(dropZone).toHaveAttribute('aria-label', 'ファイルを選択 またはドラッグ＆ドロップ');
      expect(dropZone).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('SearchBar', () => {
    test('has no accessibility violations', async () => {
      const { container } = render(
        <SearchBar
          onSearch={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClear={vi.fn()}
          onToggleUncorrectedOnly={vi.fn()}
          matchCount={0}
          currentIndex={-1}
        />,
      );
      await checkA11y(container);
    });

    test('has proper search landmark and labels', () => {
      const { container } = render(
        <SearchBar
          onSearch={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClear={vi.fn()}
          onToggleUncorrectedOnly={vi.fn()}
          matchCount={5}
          currentIndex={2}
        />,
      );

      const searchRegion = container.querySelector('[role="search"]');
      expect(searchRegion).toHaveAttribute('aria-label', 'テキスト検索');

      const input = container.querySelector('input[type="text"]');
      expect(input).toHaveAttribute('aria-label', '検索キーワード');

      // Navigation buttons have aria-labels
      const prevButton = container.querySelector('[aria-label="前へ"]');
      expect(prevButton).toBeTruthy();

      const nextButton = container.querySelector('[aria-label="次へ"]');
      expect(nextButton).toBeTruthy();
    });
  });

  describe('MediaPlayer', () => {
    test('has no accessibility violations when no URL', async () => {
      const { container } = render(
        <MediaPlayer mediaUrl={null} />,
      );
      await checkA11y(container);
    });

    test('has no accessibility violations with URL', async () => {
      const { container } = render(
        <MediaPlayer mediaUrl="https://example.com/audio.mp3" mediaType="audio" />,
      );
      await checkA11y(container);
    });

    test('has proper ARIA attributes on controls', () => {
      const { container } = render(
        <MediaPlayer mediaUrl="https://example.com/audio.mp3" mediaType="audio" />,
      );

      const region = container.querySelector('[role="region"]');
      expect(region).toHaveAttribute('aria-label', 'メディアプレイヤー');

      const playButton = container.querySelector('[aria-label="再生"]');
      expect(playButton).toBeTruthy();

      const seekSlider = container.querySelector('input[type="range"]');
      expect(seekSlider).toHaveAttribute('aria-label', 'シーク');
      expect(seekSlider).toHaveAttribute('aria-valuemin');
      expect(seekSlider).toHaveAttribute('aria-valuemax');
      expect(seekSlider).toHaveAttribute('aria-valuenow');

      const speedGroup = container.querySelector('[role="group"]');
      expect(speedGroup).toHaveAttribute('aria-label', '再生速度');
    });
  });

  describe('DeleteConfirmDialog', () => {
    test('has no accessibility violations when open', async () => {
      const { container } = render(
        <DeleteConfirmDialog
          isOpen={true}
          title="削除確認"
          resourceName="テストファイル.mp3"
          onConfirm={async () => {}}
          onCancel={vi.fn()}
        />,
      );
      await checkA11y(container);
    });

    test('has proper dialog ARIA attributes', () => {
      const { container } = render(
        <DeleteConfirmDialog
          isOpen={true}
          title="削除確認"
          resourceName="テストファイル.mp3"
          onConfirm={async () => {}}
          onCancel={vi.fn()}
        />,
      );

      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'delete-dialog-title');
      expect(dialog).toHaveAttribute('aria-describedby', 'delete-dialog-description');
    });

    test('traps focus within dialog', () => {
      const onCancel = vi.fn();
      const { container } = render(
        <DeleteConfirmDialog
          isOpen={true}
          title="削除確認"
          resourceName="テストファイル.mp3"
          onConfirm={async () => {}}
          onCancel={onCancel}
        />,
      );

      // Cancel button should receive initial focus
      const cancelButton = container.querySelector('button:not([aria-busy])');
      expect(document.activeElement).toBe(cancelButton);
    });

    test('closes on Escape key', () => {
      const onCancel = vi.fn();
      const { container } = render(
        <DeleteConfirmDialog
          isOpen={true}
          title="削除確認"
          resourceName="テストファイル.mp3"
          onConfirm={async () => {}}
          onCancel={onCancel}
        />,
      );

      const dialog = container.querySelector('[role="dialog"]')!;
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('Navigation', () => {
    test('has no accessibility violations', async () => {
      const { container } = render(
        <MemoryRouter>
          <Navigation userRole="ADMIN" />
        </MemoryRouter>,
      );
      await checkA11y(container);
    });

    test('has proper navigation landmark', () => {
      const { container } = render(
        <MemoryRouter>
          <Navigation userRole="ADMIN" />
        </MemoryRouter>,
      );

      const nav = container.querySelector('nav');
      expect(nav).toHaveAttribute('aria-label', 'メインナビゲーション');

      const menubar = container.querySelector('[role="menubar"]');
      expect(menubar).toBeTruthy();

      const menuItems = container.querySelectorAll('[role="menuitem"]');
      expect(menuItems.length).toBeGreaterThan(0);
    });
  });
});
