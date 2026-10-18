import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SegmentEditor } from './SegmentEditor';
import type { Segment } from '../types/segment';

const createSegment = (overrides?: Partial<Segment>): Segment => ({
  segmentId: 'seg-1',
  sessionId: 'session-1',
  startTime: 65.5,
  endTime: 70.2,
  originalText: 'テストテキストです',
  speakerLabel: 'spk_0',
  consensusStatus: 'UNDECIDED',
  ...overrides,
});

describe('SegmentEditor', () => {
  describe('表示モード (Requirement 2.1)', () => {
    it('displays segment text, timestamp, and speaker label', () => {
      const segment = createSegment();
      render(<SegmentEditor segment={segment} />);

      expect(screen.getByText('テストテキストです')).toBeInTheDocument();
      expect(screen.getByText('00:01:05')).toBeInTheDocument();
      expect(screen.getByText('spk_0')).toBeInTheDocument();
    });

    it('does not display speaker label when not present', () => {
      const segment = createSegment({ speakerLabel: undefined });
      render(<SegmentEditor segment={segment} />);

      expect(screen.queryByLabelText('話者ラベル')).not.toBeInTheDocument();
    });

    it('enters edit mode on click (Requirement 2.1)', async () => {
      const user = userEvent.setup();
      const onStartEdit = vi.fn();
      const segment = createSegment();

      render(<SegmentEditor segment={segment} onStartEdit={onStartEdit} />);

      await user.click(screen.getByRole('listitem'));

      expect(onStartEdit).toHaveBeenCalledWith('seg-1', 'テストテキストです');
    });

    it('enters edit mode on Enter key', async () => {
      const user = userEvent.setup();
      const onStartEdit = vi.fn();
      const segment = createSegment();

      render(<SegmentEditor segment={segment} onStartEdit={onStartEdit} />);

      const row = screen.getByRole('listitem');
      row.focus();
      await user.keyboard('{Enter}');

      expect(onStartEdit).toHaveBeenCalledWith('seg-1', 'テストテキストです');
    });

    it('applies search highlight without dangerouslySetInnerHTML (Requirement 14.20)', () => {
      const segment = createSegment({ originalText: 'Hello World Test' });
      render(<SegmentEditor segment={segment} searchQuery="World" />);

      const mark = screen.getByText('World');
      expect(mark.tagName).toBe('MARK');
    });
  });

  describe('編集モード (Requirement 2.2)', () => {
    it('shows original text with strikethrough and editing textarea simultaneously', () => {
      const segment = createSegment();
      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText="テストテキストです"
        />
      );

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

    it('calls onUpdateText when textarea content changes', async () => {
      const user = userEvent.setup();
      const onUpdateText = vi.fn();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText="テスト"
          onUpdateText={onUpdateText}
        />
      );

      const textarea = screen.getByLabelText('編集テキスト');
      await user.type(textarea, 'A');

      expect(onUpdateText).toHaveBeenCalledWith('seg-1', 'テストA');
    });
  });

  describe('確定操作 (Requirement 2.3)', () => {
    it('calls onConfirm with segmentId and text on confirm button click', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText="修正後テキスト"
          onConfirm={onConfirm}
        />
      );

      await user.click(screen.getByLabelText('編集を確定'));

      expect(onConfirm).toHaveBeenCalledWith('seg-1', '修正後テキスト');
    });

    it('calls onConfirm on Ctrl+Enter (Requirement 11.1)', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText="修正テキスト"
          onConfirm={onConfirm}
        />
      );

      const textarea = screen.getByLabelText('編集テキスト');
      textarea.focus();
      await user.keyboard('{Control>}{Enter}{/Control}');

      expect(onConfirm).toHaveBeenCalledWith('seg-1', '修正テキスト');
    });
  });

  describe('キャンセル操作 (Requirement 2.4)', () => {
    it('calls onCancel on cancel button click', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText="テスト"
          onCancel={onCancel}
        />
      );

      await user.click(screen.getByLabelText('編集をキャンセル'));

      expect(onCancel).toHaveBeenCalledWith('seg-1');
    });

    it('calls onCancel on Escape key', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText="テスト"
          onCancel={onCancel}
        />
      );

      const textarea = screen.getByLabelText('編集テキスト');
      textarea.focus();
      await user.keyboard('{Escape}');

      expect(onCancel).toHaveBeenCalledWith('seg-1');
    });
  });

  describe('複数Segment同時編集 (Requirement 2.5)', () => {
    it('renders multiple segments in edit mode independently', () => {
      const segment1 = createSegment({ segmentId: 'seg-1', originalText: 'テキスト1' });
      const segment2 = createSegment({ segmentId: 'seg-2', originalText: 'テキスト2' });

      const { container } = render(
        <>
          <SegmentEditor segment={segment1} isEditing={true} editText="編集1" />
          <SegmentEditor segment={segment2} isEditing={true} editText="編集2" />
        </>
      );

      const textareas = container.querySelectorAll('textarea');
      expect(textareas).toHaveLength(2);
      expect(textareas[0]).toHaveValue('編集1');
      expect(textareas[1]).toHaveValue('編集2');
    });
  });

  describe('空文字列確認ダイアログ (Requirement 2.7)', () => {
    it('shows confirmation dialog when confirming with empty text', async () => {
      const user = userEvent.setup();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText=""
        />
      );

      await user.click(screen.getByLabelText('編集を確定'));

      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(screen.getByText('空のテキストで確定しますか？')).toBeInTheDocument();
    });

    it('confirms with empty text when user clicks confirm in dialog', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText=""
          onConfirm={onConfirm}
        />
      );

      await user.click(screen.getByLabelText('編集を確定'));
      await user.click(screen.getByLabelText('空のテキストで確定'));

      expect(onConfirm).toHaveBeenCalledWith('seg-1', '');
    });

    it('keeps editing state when user cancels empty confirm dialog', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const segment = createSegment();

      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText=""
          onConfirm={onConfirm}
        />
      );

      await user.click(screen.getByLabelText('編集を確定'));
      await user.click(screen.getByLabelText('空文字列確定をキャンセル'));

      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      // Still in edit mode
      expect(screen.getByLabelText('編集テキスト')).toBeInTheDocument();
    });
  });

  describe('dangerouslySetInnerHTML不使用 (Requirement 14.20)', () => {
    it('renders text with React default escaping', () => {
      const segment = createSegment({
        originalText: '<script>alert("xss")</script>',
      });
      render(<SegmentEditor segment={segment} />);

      // Text should be displayed as-is, not executed
      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument();
    });

    it('renders edit text with React default escaping in edit mode', () => {
      const segment = createSegment({
        originalText: '<img src=x onerror=alert(1)>',
      });
      render(
        <SegmentEditor
          segment={segment}
          isEditing={true}
          editText="<img src=x onerror=alert(1)>"
        />
      );

      // Original text should be escaped
      const originalEl = screen.getByLabelText('編集前テキスト');
      expect(originalEl).toHaveTextContent('<img src=x onerror=alert(1)>');
    });
  });

  describe('修正前/修正後の並列表示 (Requirement 1)', () => {
    it('displays both original and corrected text with labels for a corrected segment', () => {
      const segment = createSegment({ originalText: '修正後テキスト' });
      render(
        <SegmentEditor
          segment={segment}
          displayCorrection={{
            originalText: '修正前テキスト',
            correctedText: '修正後テキスト',
          }}
        />
      );

      expect(screen.getByText('修正前テキスト')).toBeInTheDocument();
      expect(screen.getByLabelText('修正前のテキスト')).toHaveTextContent('修正前テキスト');
      expect(screen.getByLabelText('修正後のテキスト')).toHaveTextContent('修正後テキスト');
      // 視覚ラベル（色だけに依存しない）
      expect(screen.getByText('修正前')).toBeInTheDocument();
      expect(screen.getByText('修正後')).toBeInTheDocument();
    });

    it('applies search highlight to the corrected text only (Requirement 1)', () => {
      const segment = createSegment({ originalText: 'Hello World After' });
      render(
        <SegmentEditor
          segment={segment}
          searchQuery="World"
          displayCorrection={{
            originalText: 'Hello Before',
            correctedText: 'Hello World After',
          }}
        />
      );

      const mark = screen.getByText('World');
      expect(mark.tagName).toBe('MARK');
      // ハイライトは修正後テキスト側に付く
      const correctedEl = screen.getByLabelText('修正後のテキスト');
      expect(within(correctedEl).getByText('World')).toBe(mark);
    });

    it('has the original text rendered with strikethrough styling', () => {
      const segment = createSegment({ originalText: '修正後テキスト' });
      render(
        <SegmentEditor
          segment={segment}
          displayCorrection={{
            originalText: '修正前テキスト',
            correctedText: '修正後テキスト',
          }}
        />
      );

      expect(screen.getByLabelText('修正前のテキスト')).toHaveClass('line-through');
    });

    it('has no accessibility violations for a corrected segment (WCAG 2.1 AA)', async () => {
      const segment = createSegment({ originalText: '修正後テキスト' });
      // role="listitem" は role="list" の親を要求するため list でラップする
      const { container } = render(
        <div role="list" aria-label="文字起こしセグメント一覧">
          <SegmentEditor
            segment={segment}
            displayCorrection={{
              originalText: '修正前テキスト',
              correctedText: '修正後テキスト',
            }}
          />
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('未修正セグメントの表示 (Requirement 2)', () => {
    it('does not display a corrected row when displayCorrection is undefined', () => {
      const segment = createSegment();
      render(<SegmentEditor segment={segment} />);

      expect(screen.queryByText('修正後')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('修正後のテキスト')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('修正前のテキスト')).not.toBeInTheDocument();
      expect(screen.getByText('テストテキストです')).toBeInTheDocument();
    });

    it('shows an "未修正" label so the state is not conveyed by color alone', () => {
      const segment = createSegment();
      render(<SegmentEditor segment={segment} />);

      expect(screen.getByLabelText('未修正')).toBeInTheDocument();
    });

    it('has no accessibility violations for an uncorrected segment (WCAG 2.1 AA)', async () => {
      const segment = createSegment();
      // role="listitem" は role="list" の親を要求するため list でラップする
      const { container } = render(
        <div role="list" aria-label="文字起こしセグメント一覧">
          <SegmentEditor segment={segment} />
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('修正前に戻す (要件A)', () => {
    const correctedProps = {
      originalText: '修正前テキスト',
      correctedText: '修正後テキスト',
    };

    it('shows the revert button for a corrected segment when onRevert is provided and calls it on click', async () => {
      const user = userEvent.setup();
      const onRevert = vi.fn();
      const segment = createSegment({ originalText: '修正後テキスト' });

      render(
        <SegmentEditor
          segment={segment}
          displayCorrection={correctedProps}
          onRevert={onRevert}
        />
      );

      const revertButton = screen.getByLabelText('修正前に戻す');
      expect(revertButton).toBeInTheDocument();

      await user.click(revertButton);
      expect(onRevert).toHaveBeenCalledWith('seg-1');
    });

    it('does not show the revert button when onRevert is not provided', () => {
      const segment = createSegment({ originalText: '修正後テキスト' });

      render(
        <SegmentEditor segment={segment} displayCorrection={correctedProps} />
      );

      expect(screen.queryByLabelText('修正前に戻す')).not.toBeInTheDocument();
    });

    it('does not show the revert button for an uncorrected segment even when onRevert is provided', () => {
      const onRevert = vi.fn();
      const segment = createSegment();

      render(<SegmentEditor segment={segment} onRevert={onRevert} />);

      expect(screen.queryByLabelText('修正前に戻す')).not.toBeInTheDocument();
    });

    it('shows both the revert and suggestion buttons for a corrected segment (要件A/B共存)', async () => {
      const user = userEvent.setup();
      const onRevert = vi.fn();
      const onSuggestionRequest = vi.fn();
      const segment = createSegment({ originalText: '修正後テキスト' });

      render(
        <SegmentEditor
          segment={segment}
          displayCorrection={correctedProps}
          onRevert={onRevert}
          onSuggestionRequest={onSuggestionRequest}
        />
      );

      const revertButton = screen.getByLabelText('修正前に戻す');
      const suggestionButton = screen.getByLabelText('修正候補を表示');
      expect(revertButton).toBeInTheDocument();
      expect(suggestionButton).toBeInTheDocument();

      await user.click(revertButton);
      expect(onRevert).toHaveBeenCalledWith('seg-1');

      await user.click(suggestionButton);
      expect(onSuggestionRequest).toHaveBeenCalledWith('seg-1', '修正後テキスト');
    });

    it('has no accessibility violations with both revert and suggestion buttons (WCAG 2.1 AA)', async () => {
      const segment = createSegment({ originalText: '修正後テキスト' });
      const { container } = render(
        <div role="list" aria-label="文字起こしセグメント一覧">
          <SegmentEditor
            segment={segment}
            displayCorrection={correctedProps}
            onRevert={vi.fn()}
            onSuggestionRequest={vi.fn()}
          />
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('アクセシビリティ', () => {
    it('has proper ARIA attributes in view mode', () => {
      const segment = createSegment();
      render(<SegmentEditor segment={segment} />);

      const row = screen.getByRole('listitem');
      expect(row).toHaveAttribute('tabIndex', '0');
      expect(row).toHaveAttribute('aria-label', 'セグメント 00:01:05');
    });

    it('has proper ARIA attributes in edit mode', () => {
      const segment = createSegment();
      render(
        <SegmentEditor segment={segment} isEditing={true} editText="テスト" />
      );

      expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'インライン編集');
      expect(screen.getByLabelText('編集テキスト')).toBeInTheDocument();
      expect(screen.getByLabelText('編集を確定')).toBeInTheDocument();
      expect(screen.getByLabelText('編集をキャンセル')).toBeInTheDocument();
    });

    it('sets aria-current when highlighted', () => {
      const segment = createSegment();
      render(<SegmentEditor segment={segment} isHighlighted={true} />);

      expect(screen.getByRole('listitem')).toHaveAttribute('aria-current', 'true');
    });
  });
});
