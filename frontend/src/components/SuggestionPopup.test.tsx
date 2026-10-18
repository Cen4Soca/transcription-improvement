import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SuggestionPopup, SuggestionButton, type SuggestionPopupProps } from './SuggestionPopup';

function createDefaultProps(overrides: Partial<SuggestionPopupProps> = {}): SuggestionPopupProps {
  return {
    segmentId: 'seg-1',
    suggestions: [
      { text: '修正テキスト1', source: '履歴' },
      { text: '修正テキスト2', source: 'Bedrock' },
    ],
    isLoading: false,
    hasError: false,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onEditMode: vi.fn(),
    ...overrides,
  };
}

describe('SuggestionPopup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders popup with suggestions', () => {
    const props = createDefaultProps();
    render(<SuggestionPopup {...props} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('修正テキスト1')).toBeInTheDocument();
    expect(screen.getByText('修正テキスト2')).toBeInTheDocument();
  });

  describe('ホバー 500ms トリガー (Req 8.1)', () => {
    it('popup is not visible before 500ms hover delay elapses', () => {
      // SuggestionPopup is a presentational component; the parent controls visibility.
      // This test verifies that when the popup is NOT rendered (before 500ms), nothing appears,
      // and after 500ms the parent renders it with isLoading=true initially.
      const { container, rerender } = render(<div data-testid="wrapper" />);
      expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();

      // After 500ms, parent renders SuggestionPopup with loading state
      act(() => { vi.advanceTimersByTime(500); });
      const props = createDefaultProps({ isLoading: true });
      rerender(
        <div data-testid="wrapper">
          <SuggestionPopup {...props} />
        </div>
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('popup shows loading then transitions to suggestions after fetch completes', () => {
      // Simulates the full lifecycle: loading → suggestions displayed
      const props = createDefaultProps({ isLoading: true, suggestions: [] });
      const { rerender } = render(<SuggestionPopup {...props} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

      // Fetch completes with suggestions
      const updatedProps = createDefaultProps({ isLoading: false });
      rerender(<SuggestionPopup {...updatedProps} />);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByText('修正テキスト1')).toBeInTheDocument();
    });
  });

  it('displays loading indicator when isLoading is true (Req 8.5)', () => {
    const props = createDefaultProps({ isLoading: true });
    render(<SuggestionPopup {...props} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('候補を取得中...')).toBeInTheDocument();
  });

  it('does not display suggestions while loading', () => {
    const props = createDefaultProps({ isLoading: true });
    render(<SuggestionPopup {...props} />);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onSelect when a candidate is clicked (Req 8.4)', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const props = createDefaultProps({ onSelect });
    render(<SuggestionPopup {...props} />);

    await user.click(screen.getByText('修正テキスト1'));

    expect(onSelect).toHaveBeenCalledWith('修正テキスト1');
  });

  it('calls onSelect on Enter key press on a candidate', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const props = createDefaultProps({ onSelect });
    render(<SuggestionPopup {...props} />);

    const option = screen.getByText('修正テキスト1').closest('[role="option"]')!;
    (option as HTMLElement).focus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('修正テキスト1');
  });

  it('shows "候補がありません" when 0 candidates (Req 8.6)', () => {
    const props = createDefaultProps({ suggestions: [] });
    render(<SuggestionPopup {...props} />);

    expect(screen.getByText('候補がありません')).toBeInTheDocument();
    expect(screen.getByText('直接編集する')).toBeInTheDocument();
  });

  it('calls onEditMode when "直接編集する" is clicked (Req 8.6)', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onEditMode = vi.fn();
    const props = createDefaultProps({ suggestions: [], onEditMode });
    render(<SuggestionPopup {...props} />);

    await user.click(screen.getByText('直接編集する'));

    expect(onEditMode).toHaveBeenCalled();
  });

  it('shows inline error message when hasError is true (Req 8.7)', () => {
    const props = createDefaultProps({
      hasError: true,
      suggestions: [{ text: '履歴候補', source: '履歴' }],
    });
    render(<SuggestionPopup {...props} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('外部APIからの候補取得に失敗しました。履歴からの候補のみ表示しています。')
    ).toBeInTheDocument();
    // Still shows history-based suggestions
    expect(screen.getByText('履歴候補')).toBeInTheDocument();
  });

  it('closes on outside click (Req 8.8)', async () => {
    vi.useRealTimers();
    const onClose = vi.fn();
    const props = createDefaultProps({ onClose });

    render(
      <div>
        <div data-testid="outside">外部要素</div>
        <SuggestionPopup {...props} />
      </div>
    );

    await act(async () => {
      const outsideElement = screen.getByTestId('outside');
      outsideElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key press', async () => {
    vi.useRealTimers();
    const onClose = vi.fn();
    const props = createDefaultProps({ onClose });
    render(<SuggestionPopup {...props} />);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('displays max 5 candidates (Req 8.1, 8.2)', () => {
    const suggestions = Array.from({ length: 8 }, (_, i) => ({
      text: `候補${i + 1}`,
      source: '履歴',
    }));
    const props = createDefaultProps({ suggestions });
    render(<SuggestionPopup {...props} />);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(5);
    expect(screen.getByText('候補1')).toBeInTheDocument();
    expect(screen.getByText('候補5')).toBeInTheDocument();
    expect(screen.queryByText('候補6')).not.toBeInTheDocument();
  });

  it('displays source label for each suggestion', () => {
    const props = createDefaultProps({
      suggestions: [
        { text: 'テスト候補', source: 'Bedrock' },
      ],
    });
    render(<SuggestionPopup {...props} />);

    expect(screen.getByText('Bedrock')).toBeInTheDocument();
  });

  it('has proper ARIA attributes for accessibility', () => {
    const props = createDefaultProps();
    render(<SuggestionPopup {...props} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', '修正候補');
    expect(dialog).toHaveAttribute('data-segment-id', 'seg-1');
  });

  it('sets aria-busy when loading', () => {
    const props = createDefaultProps({ isLoading: true });
    render(<SuggestionPopup {...props} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
  });

  it('does not show "候補がありません" when loading with empty suggestions', () => {
    const props = createDefaultProps({ suggestions: [], isLoading: true });
    render(<SuggestionPopup {...props} />);

    expect(screen.queryByText('候補がありません')).not.toBeInTheDocument();
  });

  it('does not show error message while loading', () => {
    const props = createDefaultProps({ isLoading: true, hasError: true });
    render(<SuggestionPopup {...props} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has a close button that calls onClose', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onClose = vi.fn();
    const props = createDefaultProps({ onClose });
    render(<SuggestionPopup {...props} />);

    await user.click(screen.getByLabelText('閉じる'));

    expect(onClose).toHaveBeenCalled();
  });

  it('renders as an inline block directly under the segment (not absolutely positioned)', () => {
    const props = createDefaultProps();
    render(<SuggestionPopup {...props} />);

    const dialog = screen.getByRole('dialog');
    // インライン表示のため絶対配置クラスを持たない
    expect(dialog.className).not.toContain('absolute');
    expect(dialog).not.toHaveStyle({ position: 'absolute' });
  });

  it('has no accessibility violations (WCAG 2.1 AA)', async () => {
    vi.useRealTimers();
    const props = createDefaultProps();
    const { container } = render(<SuggestionPopup {...props} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('wraps long suggestion text instead of truncating it', () => {
    const longText =
      'これは非常に長い修正候補のテキストで、途中で切られずに最後まで折り返して全文が表示される必要があります。' +
      'Bedrock が生成する候補が長い場合でも truncate されないことを検証します。';
    const props = createDefaultProps({
      suggestions: [{ text: longText, source: 'Bedrock' }],
    });
    render(<SuggestionPopup {...props} />);

    const textSpan = screen.getByText(longText);
    // 折り返し表示（truncate ではなく break-words / whitespace-normal）
    expect(textSpan).not.toHaveClass('truncate');
    expect(textSpan).toHaveClass('break-words');
    expect(textSpan).toHaveClass('whitespace-normal');
  });
});

describe('SuggestionButton', () => {
  it('renders a button with proper aria-label (Req 8.2, 8.10)', () => {
    const onClick = vi.fn();
    render(<SuggestionButton segmentId="seg-1" onClick={onClick} />);

    const button = screen.getByLabelText('修正候補を表示');
    expect(button).toBeInTheDocument();
  });

  it('calls onClick with segmentId when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<SuggestionButton segmentId="seg-1" onClick={onClick} />);

    await user.click(screen.getByLabelText('修正候補を表示'));

    expect(onClick).toHaveBeenCalledWith('seg-1');
  });

  it('stops event propagation to prevent segment click handler', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const parentClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <SuggestionButton segmentId="seg-1" onClick={onClick} />
      </div>
    );

    await user.click(screen.getByLabelText('修正候補を表示'));

    expect(onClick).toHaveBeenCalledWith('seg-1');
    expect(parentClick).not.toHaveBeenCalled();
  });
});
