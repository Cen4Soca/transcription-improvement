import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SpeakerLabelManager } from './SpeakerLabelManager';
import type { Segment } from '../types/segment';

function createSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 5,
    originalText: 'テストテキスト',
    speakerLabel: 'spk_0',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('SpeakerLabelManager', () => {
  const segments: Segment[] = [
    createSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0', startTime: 0 }),
    createSegment({ segmentId: 'seg-2', speakerLabel: 'spk_0', startTime: 5 }),
    createSegment({ segmentId: 'seg-3', speakerLabel: 'spk_1', startTime: 10 }),
    createSegment({ segmentId: 'seg-4', speakerLabel: 'spk_1', startTime: 15 }),
    createSegment({ segmentId: 'seg-5', speakerLabel: 'spk_2', startTime: 20 }),
  ];

  const defaultProps = {
    segments,
    onRenameConfirm: vi.fn(),
    onCancel: vi.fn(),
    isOpen: true,
    onClose: vi.fn(),
  };

  describe('話者ラベル管理画面表示 (Requirement 2.13)', () => {
    it('displays all unique speaker labels', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      expect(screen.getByText('spk_0')).toBeInTheDocument();
      expect(screen.getByText('spk_1')).toBeInTheDocument();
      expect(screen.getByText('spk_2')).toBeInTheDocument();
    });

    it('shows segment count for each label', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      // spk_0 and spk_1 both have 2 segments, spk_2 has 1
      const countElements = screen.getAllByText(/\(\d+件\)/);
      expect(countElements).toHaveLength(3);
      expect(screen.getByText('(1件)')).toBeInTheDocument(); // spk_2 has 1
    });

    it('shows rename button for each label', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      const renameButtons = screen.getAllByRole('button', { name: /の名前を変更/ });
      expect(renameButtons).toHaveLength(3);
    });

    it('does not render when isOpen is false', () => {
      render(<SpeakerLabelManager {...defaultProps} isOpen={false} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows empty message when no labels exist', () => {
      render(
        <SpeakerLabelManager
          {...defaultProps}
          segments={[createSegment({ speakerLabel: undefined })]}
        />
      );

      expect(screen.getByText('話者ラベルがありません')).toBeInTheDocument();
    });
  });

  describe('ラベル名変更 (Requirement 2.14)', () => {
    it('shows input field when rename button is clicked', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelManager {...defaultProps} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );

      expect(
        screen.getByLabelText('spk_0 の新しいラベル名')
      ).toBeInTheDocument();
    });

    it('calls onRenameConfirm with updated segments on rename', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, '田中');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ segmentId: 'seg-1', speakerLabel: '田中' }),
          expect.objectContaining({ segmentId: 'seg-2', speakerLabel: '田中' }),
          expect.objectContaining({ segmentId: 'seg-3', speakerLabel: 'spk_1' }),
        ]),
        {
          oldLabel: 'spk_0',
          newLabel: '田中',
          affectedSegmentCount: 2,
        }
      );
    });

    it('confirms rename with Enter key', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, '佐藤');
      await user.keyboard('{Enter}');

      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          oldLabel: 'spk_0',
          newLabel: '佐藤',
          affectedSegmentCount: 2,
        })
      );
    });

    it('does not call onRenameConfirm when label name is unchanged', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      // Don't change the text, just confirm
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      expect(onRenameConfirm).not.toHaveBeenCalled();
    });
  });

  describe('キャンセル操作 (Requirement 2.16)', () => {
    it('calls onCancel when cancel button is clicked during rename', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<SpeakerLabelManager {...defaultProps} onCancel={onCancel} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      await user.click(screen.getByLabelText('ラベル名変更をキャンセル'));

      expect(onCancel).toHaveBeenCalled();
    });

    it('cancels rename with Escape key', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<SpeakerLabelManager {...defaultProps} onCancel={onCancel} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      input.focus();
      await user.keyboard('{Escape}');

      expect(onCancel).toHaveBeenCalled();
    });

    it('hides input field after cancel', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelManager {...defaultProps} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      expect(
        screen.getByLabelText('spk_0 の新しいラベル名')
      ).toBeInTheDocument();

      await user.click(screen.getByLabelText('ラベル名変更をキャンセル'));

      expect(
        screen.queryByLabelText('spk_0 の新しいラベル名')
      ).not.toBeInTheDocument();
    });
  });

  describe('ラベル名重複時の確認ダイアログ (Requirement 2.17)', () => {
    it('shows merge confirmation dialog when new name conflicts with existing label', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelManager {...defaultProps} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, 'spk_1');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText(/「spk_1」は既に存在します/)).toBeInTheDocument();
    });

    it('executes merge when user confirms in dialog', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, 'spk_1');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      // Confirm merge
      await user.click(screen.getByLabelText('統合を確定'));

      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ segmentId: 'seg-1', speakerLabel: 'spk_1' }),
          expect.objectContaining({ segmentId: 'seg-2', speakerLabel: 'spk_1' }),
        ]),
        {
          oldLabel: 'spk_0',
          newLabel: 'spk_1',
          affectedSegmentCount: 2,
        }
      );
    });

    it('keeps editing state when user cancels merge dialog', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前を変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, 'spk_1');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      // Cancel merge
      await user.click(screen.getByLabelText('統合をキャンセル'));

      expect(onRenameConfirm).not.toHaveBeenCalled();
      // Should still be in editing state
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('話者識別情報がない場合 (Requirement 2.9)', () => {
    it('shows empty message when segments have no speaker labels', () => {
      const noSpeakerSegments = [
        createSegment({ segmentId: 'seg-1', speakerLabel: undefined }),
        createSegment({ segmentId: 'seg-2', speakerLabel: undefined }),
      ];
      render(
        <SpeakerLabelManager {...defaultProps} segments={noSpeakerSegments} />
      );

      expect(screen.getByText('話者ラベルがありません')).toBeInTheDocument();
    });
  });

  describe('パネル操作', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<SpeakerLabelManager {...defaultProps} onClose={onClose} />);

      await user.click(
        screen.getByLabelText('話者ラベル管理を閉じる')
      );

      expect(onClose).toHaveBeenCalled();
    });

    it('has proper dialog role and label', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      const dialog = screen.getByRole('dialog', { name: '話者ラベル管理' });
      expect(dialog).toBeInTheDocument();
    });
  });

  describe('話者ラベルの追加', () => {
    it('shows the add input when onAddLabel is provided', () => {
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={vi.fn()} />);
      expect(screen.getByLabelText('追加する話者ラベル名')).toBeInTheDocument();
    });

    it('does not show the add input when onAddLabel is not provided', () => {
      render(<SpeakerLabelManager {...defaultProps} />);
      expect(
        screen.queryByLabelText('追加する話者ラベル名')
      ).not.toBeInTheDocument();
    });

    it('calls onAddLabel with the trimmed label and clears input on success', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');
      await user.type(input, '  新しい話者  ');
      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(onAddLabel).toHaveBeenCalledWith('新しい話者');
      expect((input as HTMLInputElement).value).toBe('');
    });

    it('shows a Japanese error when the label is empty', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(onAddLabel).not.toHaveBeenCalled();
      expect(
        screen.getByText('話者ラベルを入力してください。')
      ).toBeInTheDocument();
    });

    it('shows a Japanese error when the label duplicates an existing one', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');
      await user.type(input, 'spk_0');
      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(onAddLabel).not.toHaveBeenCalled();
      expect(
        screen.getByText('同じ名前の話者ラベルが既に存在します。')
      ).toBeInTheDocument();
    });

    it('surfaces the server error message returned by onAddLabel', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi
        .fn()
        .mockResolvedValue('話者ラベルは既に存在します。');
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');
      await user.type(input, '新規');
      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(
        screen.getByText('話者ラベルは既に存在します。')
      ).toBeInTheDocument();
    });

    it('shows a master label that has no segments via masterLabels', () => {
      render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onAddLabel={vi.fn()}
          onDeleteLabel={vi.fn()}
        />
      );
      expect(screen.getByText('未使用話者')).toBeInTheDocument();
      // Unused master label (0 segments) is deletable.
      expect(
        screen.getByLabelText('未使用話者 を削除')
      ).toBeInTheDocument();
    });
  });

  describe('話者ラベルの削除', () => {
    it('disables the delete button for a label still in use', () => {
      render(
        <SpeakerLabelManager {...defaultProps} onDeleteLabel={vi.fn()} />
      );
      // spk_0 is used by 2 segments → delete disabled.
      const disabledDelete = screen.getByLabelText(
        'spk_0 を削除（使用中のため不可）'
      );
      expect(disabledDelete).toBeDisabled();
    });

    it('calls onDeleteLabel for an unused label', async () => {
      const user = userEvent.setup();
      const onDeleteLabel = vi.fn().mockResolvedValue(null);
      render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onDeleteLabel={onDeleteLabel}
        />
      );

      await user.click(screen.getByLabelText('未使用話者 を削除'));

      expect(onDeleteLabel).toHaveBeenCalledWith('未使用話者');
    });

    it('shows the server error message when deletion fails', async () => {
      const user = userEvent.setup();
      const onDeleteLabel = vi
        .fn()
        .mockResolvedValue('この話者ラベルは使用中のため削除できません。');
      render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onDeleteLabel={onDeleteLabel}
        />
      );

      await user.click(screen.getByLabelText('未使用話者 を削除'));

      expect(
        screen.getByText('この話者ラベルは使用中のため削除できません。')
      ).toBeInTheDocument();
    });
  });

  describe('アクセシビリティ (WCAG 2.1 AA)', () => {
    it('has no accessibility violations', async () => {
      const { container } = render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onAddLabel={vi.fn()}
          onDeleteLabel={vi.fn()}
        />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
