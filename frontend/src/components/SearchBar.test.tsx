import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  const defaultProps = {
    onSearch: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onClear: vi.fn(),
    onToggleUncorrectedOnly: vi.fn(),
    matchCount: 0,
    currentIndex: -1,
  };

  it('renders search input', () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.getByLabelText('検索キーワード')).toBeInTheDocument();
  });

  it('calls onSearch when typing', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchBar {...defaultProps} onSearch={onSearch} />);

    await user.type(screen.getByLabelText('検索キーワード'), 'test');
    expect(onSearch).toHaveBeenCalledWith('t');
    expect(onSearch).toHaveBeenCalledWith('te');
    expect(onSearch).toHaveBeenCalledWith('tes');
    expect(onSearch).toHaveBeenCalledWith('test');
  });

  it('calls onNext when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<SearchBar {...defaultProps} onNext={onNext} matchCount={3} currentIndex={0} />);

    const input = screen.getByLabelText('検索キーワード');
    await user.type(input, 'a');
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalled();
  });

  it('calls onPrevious when Shift+Enter is pressed', async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    render(<SearchBar {...defaultProps} onPrevious={onPrevious} matchCount={3} currentIndex={1} />);

    const input = screen.getByLabelText('検索キーワード');
    await user.type(input, 'a');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onPrevious).toHaveBeenCalled();
  });

  it('calls onClear when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<SearchBar {...defaultProps} onClear={onClear} />);

    const input = screen.getByLabelText('検索キーワード');
    await user.type(input, 'test');
    await user.keyboard('{Escape}');
    expect(onClear).toHaveBeenCalled();
  });

  it('calls onClear when clear button is clicked', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<SearchBar {...defaultProps} onClear={onClear} matchCount={2} currentIndex={0} />);

    const input = screen.getByLabelText('検索キーワード');
    await user.type(input, 'test');

    const clearButton = screen.getByLabelText('検索クリア');
    await user.click(clearButton);
    expect(onClear).toHaveBeenCalled();
  });

  it('displays match count when keyword is entered', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SearchBar {...defaultProps} matchCount={5} currentIndex={-1} />);

    const input = screen.getByLabelText('検索キーワード');
    await user.type(input, 'a');

    rerender(<SearchBar {...defaultProps} matchCount={5} currentIndex={-1} />);
    // After typing, the match label should show
    expect(screen.getByText('5件一致')).toBeInTheDocument();
  });

  it('displays position when currentIndex is valid', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SearchBar {...defaultProps} matchCount={5} currentIndex={2} />);

    const input = screen.getByLabelText('検索キーワード');
    await user.type(input, 'a');

    rerender(<SearchBar {...defaultProps} matchCount={5} currentIndex={2} />);
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });

  it('disables navigation buttons when no matches', () => {
    render(<SearchBar {...defaultProps} matchCount={0} currentIndex={-1} />);

    expect(screen.getByLabelText('次へ')).toBeDisabled();
    expect(screen.getByLabelText('前へ')).toBeDisabled();
  });

  it('enables navigation buttons when matches exist', () => {
    render(<SearchBar {...defaultProps} matchCount={3} currentIndex={0} />);

    expect(screen.getByLabelText('次へ')).not.toBeDisabled();
    expect(screen.getByLabelText('前へ')).not.toBeDisabled();
  });

  it('calls onNext when next button is clicked', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<SearchBar {...defaultProps} onNext={onNext} matchCount={3} currentIndex={0} />);

    await user.click(screen.getByLabelText('次へ'));
    expect(onNext).toHaveBeenCalled();
  });

  it('calls onPrevious when previous button is clicked', async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    render(<SearchBar {...defaultProps} onPrevious={onPrevious} matchCount={3} currentIndex={1} />);

    await user.click(screen.getByLabelText('前へ'));
    expect(onPrevious).toHaveBeenCalled();
  });

  it('toggles uncorrected-only filter', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<SearchBar {...defaultProps} onToggleUncorrectedOnly={onToggle} />);

    await user.click(screen.getByLabelText('未修正のみ表示'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(<SearchBar {...defaultProps} />);

    expect(screen.getByRole('search')).toHaveAttribute('aria-label', 'テキスト検索');
    expect(screen.getByLabelText('検索キーワード')).toBeInTheDocument();
  });
});
