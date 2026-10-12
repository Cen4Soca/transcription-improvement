import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptionEditor } from './TranscriptionEditor';
import type { Segment } from '../types/segment';

function createSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 5,
    originalText: 'テストテキスト',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('TranscriptionEditor', () => {
  describe('rendering segments', () => {
    it('renders all segments', () => {
      const segments = [
        createSegment({ segmentId: 'seg-1', originalText: 'セグメント1' }),
        createSegment({ segmentId: 'seg-2', originalText: 'セグメント2' }),
        createSegment({ segmentId: 'seg-3', originalText: 'セグメント3' }),
      ];

      render(<TranscriptionEditor segments={segments} />);

      expect(screen.getByText('セグメント1')).toBeInTheDocument();
      expect(screen.getByText('セグメント2')).toBeInTheDocument();
      expect(screen.getByText('セグメント3')).toBeInTheDocument();
    });

    it('sorts segments by startTime ascending', () => {
      const segments = [
        createSegment({ segmentId: 'seg-3', startTime: 30, originalText: '三番目' }),
        createSegment({ segmentId: 'seg-1', startTime: 10, originalText: '一番目' }),
        createSegment({ segmentId: 'seg-2', startTime: 20, originalText: '二番目' }),
      ];

      render(<TranscriptionEditor segments={segments} />);

      const rows = screen.getAllByRole('listitem');
      expect(rows[0]).toHaveTextContent('一番目');
      expect(rows[1]).toHaveTextContent('二番目');
      expect(rows[2]).toHaveTextContent('三番目');
    });

    it('renders in a scrollable container', () => {
      const segments = [createSegment()];

      render(<TranscriptionEditor segments={segments} />);

      const list = screen.getByRole('list');
      expect(list.className).toContain('overflow-y-auto');
    });

    it('passes highlightedSegmentId to the correct SegmentRow', () => {
      const segments = [
        createSegment({ segmentId: 'seg-1', originalText: 'テキスト1' }),
        createSegment({ segmentId: 'seg-2', originalText: 'テキスト2' }),
      ];

      render(
        <TranscriptionEditor segments={segments} highlightedSegmentId="seg-2" />
      );

      const rows = screen.getAllByRole('listitem');
      expect(rows[0]).not.toHaveAttribute('aria-current');
      expect(rows[1]).toHaveAttribute('aria-current', 'true');
    });

    it('calls onSegmentClick when a segment is clicked', async () => {
      const user = userEvent.setup();
      const onSegmentClick = vi.fn();
      const segments = [
        createSegment({ segmentId: 'seg-click', originalText: 'クリック対象' }),
      ];

      render(
        <TranscriptionEditor segments={segments} onSegmentClick={onSegmentClick} />
      );

      await user.click(screen.getByRole('listitem'));

      expect(onSegmentClick).toHaveBeenCalledWith('seg-click');
    });
  });

  describe('empty state', () => {
    it('displays empty message when segments array is empty', () => {
      render(<TranscriptionEditor segments={[]} />);

      expect(screen.getByText('文字起こし結果がありません')).toBeInTheDocument();
    });

    it('does not render segment list when empty', () => {
      render(<TranscriptionEditor segments={[]} />);

      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('displays error message with reason', () => {
      const error = { message: 'ネットワーク接続に失敗しました' };

      render(<TranscriptionEditor segments={[]} error={error} />);

      expect(screen.getByText('データの取得に失敗しました')).toBeInTheDocument();
      expect(screen.getByText('ネットワーク接続に失敗しました')).toBeInTheDocument();
    });

    it('has alert role for accessibility', () => {
      const error = { message: 'サーバーエラー' };

      render(<TranscriptionEditor segments={[]} error={error} />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('shows error state instead of segments when error is present', () => {
      const segments = [createSegment({ originalText: '表示されないテキスト' })];
      const error = { message: 'エラーが発生しました' };

      render(<TranscriptionEditor segments={segments} error={error} />);

      expect(screen.queryByText('表示されないテキスト')).not.toBeInTheDocument();
      expect(screen.getByText('エラーが発生しました')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('displays loading indicator when isLoading is true', () => {
      render(<TranscriptionEditor segments={[]} isLoading />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    });

    it('does not render segments while loading', () => {
      const segments = [createSegment({ originalText: '非表示テキスト' })];

      render(<TranscriptionEditor segments={segments} isLoading />);

      expect(screen.queryByText('非表示テキスト')).not.toBeInTheDocument();
    });

    it('has proper aria-label for loading state', () => {
      render(<TranscriptionEditor segments={[]} isLoading />);

      expect(screen.getByLabelText('読み込み中')).toBeInTheDocument();
    });
  });

  describe('inline suggestion popup (Req 8.x)', () => {
    function createSuggestionProp(
      overrides: Partial<{
        isVisible: boolean;
        segmentId: string | null;
        suggestions: Array<{ text: string; source: string }>;
        isLoading: boolean;
        hasError: boolean;
        onSelect: (text: string) => void;
        onClose: () => void;
        onEditMode: () => void;
      }> = {}
    ) {
      return {
        isVisible: true,
        segmentId: 'seg-2',
        suggestions: [{ text: '修正候補A', source: '履歴' }],
        isLoading: false,
        hasError: false,
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onEditMode: vi.fn(),
        ...overrides,
      };
    }

    it('renders the suggestion popup directly under the target segment', () => {
      const segments = [
        createSegment({ segmentId: 'seg-1', startTime: 10, originalText: '一番目' }),
        createSegment({ segmentId: 'seg-2', startTime: 20, originalText: '二番目' }),
        createSegment({ segmentId: 'seg-3', startTime: 30, originalText: '三番目' }),
      ];

      render(
        <TranscriptionEditor
          segments={segments}
          suggestion={createSuggestionProp({ segmentId: 'seg-2' })}
        />
      );

      const dialog = screen.getByRole('dialog', { name: '修正候補' });
      expect(dialog).toBeInTheDocument();

      // list の子要素を辿り、対象セグメント(seg-2)の直後に dialog が来ることを確認
      const list = screen.getByRole('list');
      const children = Array.from(list.children);
      const targetIndex = children.findIndex(
        (el) => el.getAttribute('data-segment-id') === 'seg-2'
      );
      expect(targetIndex).toBeGreaterThanOrEqual(0);
      const next = children[targetIndex + 1];
      expect(next).toBe(dialog);
    });

    it('does not render the popup when isVisible is false', () => {
      const segments = [createSegment({ segmentId: 'seg-1' })];

      render(
        <TranscriptionEditor
          segments={segments}
          suggestion={createSuggestionProp({ isVisible: false, segmentId: 'seg-1' })}
        />
      );

      expect(screen.queryByRole('dialog', { name: '修正候補' })).not.toBeInTheDocument();
    });

    it('does not render the popup when no suggestion prop is provided', () => {
      const segments = [createSegment({ segmentId: 'seg-1' })];

      render(<TranscriptionEditor segments={segments} />);

      expect(screen.queryByRole('dialog', { name: '修正候補' })).not.toBeInTheDocument();
    });

    it('renders the popup only under the matching segment, not others', () => {
      const segments = [
        createSegment({ segmentId: 'seg-1', startTime: 10, originalText: '一番目' }),
        createSegment({ segmentId: 'seg-2', startTime: 20, originalText: '二番目' }),
      ];

      render(
        <TranscriptionEditor
          segments={segments}
          suggestion={createSuggestionProp({ segmentId: 'seg-2' })}
        />
      );

      // dialog は1つだけ
      expect(screen.getAllByRole('dialog', { name: '修正候補' })).toHaveLength(1);
    });
  });
});
