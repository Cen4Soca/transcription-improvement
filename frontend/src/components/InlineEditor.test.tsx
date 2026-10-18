import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineEditor } from './InlineEditor';

describe('InlineEditor', () => {
  const defaultProps = {
    segmentId: 'seg-1',
    originalText: 'テストテキストです',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  describe('表示モード (Requirement 2.1)', () => {
    it('displays original text in view mode', () => {
      render(<InlineEditor {...defaultProps} />);

      expect(screen.getByText('テストテキストです')).toBeInTheDocument();
    });

    it('switches to edit mode on click', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));

      expect(screen.getByLabelText('編集テキスト')).toBeInTheDocument();
    });

    it('switches to edit mode on Enter key', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      const textButton = screen.getByRole('button', { name: /テキストを編集/ });
      textButton.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByLabelText('編集テキスト')).toBeInTheDocument();
    });

    it('switches to edit mode on Space key', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      const textButton = screen.getByRole('button', { name: /テキストを編集/ });
      textButton.focus();
      await user.keyboard(' ');

      expect(screen.getByLabelText('編集テキスト')).toBeInTheDocument();
    });
  });

  describe('編集モード (Requirement 2.2)', () => {
    it('shows original text with strikethrough and editing textarea simultaneously', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));

      // Original text shown with strikethrough
      const originalTextEl = screen.getByLabelText('編集前テキスト');
      expect(originalTextEl).toBeInTheDocument();
      expect(originalTextEl).toHaveTextContent('テストテキストです');
      expect(originalTextEl).toHaveClass('line-through');

      // Editing textarea shown
      const textarea = screen.getByLabelText('編集テキスト');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('テストテキストです');
    });

    it('allows editing text in textarea', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      const textarea = screen.getByLabelText('編集テキスト');
      await user.clear(textarea);
      await user.type(textarea, '修正後テキスト');

      expect(textarea).toHaveValue('修正後テキスト');
    });
  });

  describe('確定操作 (Requirement 2.3)', () => {
    it('calls onConfirm with segmentId and new text on confirm button click', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<InlineEditor {...defaultProps} onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      const textarea = screen.getByLabelText('編集テキスト');
      await user.clear(textarea);
      await user.type(textarea, '新しいテキスト');
      await user.click(screen.getByLabelText('編集を確定'));

      expect(onConfirm).toHaveBeenCalledWith('seg-1', '新しいテキスト');
    });

    it('returns to view mode after confirm', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      await user.click(screen.getByLabelText('編集を確定'));

      expect(screen.queryByLabelText('編集テキスト')).not.toBeInTheDocument();
    });
  });

  describe('キャンセル操作 (Requirement 2.4)', () => {
    it('calls onCancel with segmentId on cancel button click', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<InlineEditor {...defaultProps} onCancel={onCancel} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      await user.click(screen.getByLabelText('編集をキャンセル'));

      expect(onCancel).toHaveBeenCalledWith('seg-1');
    });

    it('returns to view mode after cancel', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      await user.click(screen.getByLabelText('編集をキャンセル'));

      expect(screen.queryByLabelText('編集テキスト')).not.toBeInTheDocument();
    });

    it('cancels editing on Escape key', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<InlineEditor {...defaultProps} onCancel={onCancel} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      const textarea = screen.getByLabelText('編集テキスト');
      textarea.focus();
      await user.keyboard('{Escape}');

      expect(onCancel).toHaveBeenCalledWith('seg-1');
      expect(screen.queryByLabelText('編集テキスト')).not.toBeInTheDocument();
    });
  });

  describe('空文字列確認ダイアログ (Requirement 2.7)', () => {
    it('shows confirmation dialog when confirming with empty text', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      const textarea = screen.getByLabelText('編集テキスト');
      await user.clear(textarea);
      await user.click(screen.getByLabelText('編集を確定'));

      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(
        screen.getByText('テキストが空です。空文字列として確定しますか？')
      ).toBeInTheDocument();
    });

    it('confirms with empty text when user clicks confirm in dialog', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<InlineEditor {...defaultProps} onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      const textarea = screen.getByLabelText('編集テキスト');
      await user.clear(textarea);
      await user.click(screen.getByLabelText('編集を確定'));
      await user.click(screen.getByLabelText('空文字列として確定'));

      expect(onConfirm).toHaveBeenCalledWith('seg-1', '');
    });

    it('keeps editing state when user cancels empty confirm dialog', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<InlineEditor {...defaultProps} onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      const textarea = screen.getByLabelText('編集テキスト');
      await user.clear(textarea);
      await user.click(screen.getByLabelText('編集を確定'));
      await user.click(screen.getByLabelText('空文字列確定をキャンセル'));

      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByLabelText('編集テキスト')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('アクセシビリティ', () => {
    it('has proper ARIA attributes in view mode', () => {
      render(<InlineEditor {...defaultProps} />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('tabIndex', '0');
      expect(button).toHaveAttribute(
        'aria-label',
        'テキストを編集: テストテキストです'
      );
    });

    it('has proper ARIA attributes in edit mode', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));

      expect(screen.getByRole('group')).toHaveAttribute(
        'aria-label',
        'インライン編集'
      );
      expect(screen.getByLabelText('編集テキスト')).toBeInTheDocument();
      expect(screen.getByLabelText('編集を確定')).toBeInTheDocument();
      expect(screen.getByLabelText('編集をキャンセル')).toBeInTheDocument();
    });

    it('confirmation dialog has proper ARIA attributes', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /テキストを編集/ }));
      const textarea = screen.getByLabelText('編集テキスト');
      await user.clear(textarea);
      await user.click(screen.getByLabelText('編集を確定'));

      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveAttribute(
        'aria-labelledby',
        'empty-confirm-title-seg-1'
      );
      expect(dialog).toHaveAttribute(
        'aria-describedby',
        'empty-confirm-desc-seg-1'
      );
    });
  });
});
