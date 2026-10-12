import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentRow } from './SegmentRow';
import { highlightText } from '../utils/highlight-text';
import type { Segment } from '../types/segment';

function createSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 3661, // 01:01:01
    endTime: 3665,
    originalText: 'テストテキストです',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('SegmentRow', () => {
  it('displays segment text', () => {
    const segment = createSegment({ originalText: '文字起こしテキスト' });
    render(<SegmentRow segment={segment} />);

    expect(screen.getByText('文字起こしテキスト')).toBeInTheDocument();
  });

  it('displays start time in HH:MM:SS format', () => {
    const segment = createSegment({ startTime: 3661 }); // 01:01:01
    render(<SegmentRow segment={segment} />);

    expect(screen.getByText('01:01:01')).toBeInTheDocument();
  });

  it('displays speaker label when speakerLabel is present', () => {
    const segment = createSegment({ speakerLabel: 'spk_0' });
    render(<SegmentRow segment={segment} />);

    expect(screen.getByText('spk_0')).toBeInTheDocument();
    expect(screen.getByLabelText('話者ラベル')).toBeInTheDocument();
  });

  it('does not display speaker label when speakerLabel is absent', () => {
    const segment = createSegment({ speakerLabel: undefined });
    render(<SegmentRow segment={segment} />);

    expect(screen.queryByLabelText('話者ラベル')).not.toBeInTheDocument();
  });

  it('calls onEdit callback with segmentId on click', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const segment = createSegment({ segmentId: 'seg-42' });
    render(<SegmentRow segment={segment} onEdit={onEdit} />);

    await user.click(screen.getByRole('listitem'));

    expect(onEdit).toHaveBeenCalledWith('seg-42');
  });

  it('calls onClick callback with segmentId on click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const segment = createSegment({ segmentId: 'seg-7' });
    render(<SegmentRow segment={segment} onClick={onClick} />);

    await user.click(screen.getByRole('listitem'));

    expect(onClick).toHaveBeenCalledWith('seg-7');
  });

  it('calls onEdit on Enter key press', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const segment = createSegment({ segmentId: 'seg-enter' });
    render(<SegmentRow segment={segment} onEdit={onEdit} />);

    const row = screen.getByRole('listitem');
    row.focus();
    await user.keyboard('{Enter}');

    expect(onEdit).toHaveBeenCalledWith('seg-enter');
  });

  it('applies highlighted styles when isHighlighted is true', () => {
    const segment = createSegment();
    render(<SegmentRow segment={segment} isHighlighted />);

    const row = screen.getByRole('listitem');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row.className).toContain('bg-yellow-50');
  });

  it('applies editing styles when isEditing is true', () => {
    const segment = createSegment();
    render(<SegmentRow segment={segment} isEditing />);

    const row = screen.getByRole('listitem');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row.className).toContain('ring-2');
  });

  it('has proper ARIA attributes for accessibility', () => {
    const segment = createSegment({ startTime: 0 });
    render(<SegmentRow segment={segment} />);

    const row = screen.getByRole('listitem');
    expect(row).toHaveAttribute('aria-label', 'セグメント 00:00:00');
    expect(row).toHaveAttribute('tabIndex', '0');
  });

  describe('search highlight', () => {
    it('wraps matching text in <mark> elements when searchQuery is provided', () => {
      const segment = createSegment({ originalText: 'これはテストです' });
      const { container } = render(
        <SegmentRow segment={segment} searchQuery="テスト" />
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(1);
      expect(marks[0].textContent).toBe('テスト');
    });

    it('highlights multiple occurrences of the search query', () => {
      const segment = createSegment({ originalText: 'test is a test case' });
      const { container } = render(
        <SegmentRow segment={segment} searchQuery="test" />
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(2);
      expect(marks[0].textContent).toBe('test');
      expect(marks[1].textContent).toBe('test');
    });

    it('performs case-insensitive highlighting', () => {
      const segment = createSegment({ originalText: 'Hello World HELLO' });
      const { container } = render(
        <SegmentRow segment={segment} searchQuery="hello" />
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(2);
      expect(marks[0].textContent).toBe('Hello');
      expect(marks[1].textContent).toBe('HELLO');
    });

    it('does not use innerHTML or dangerouslySetInnerHTML', () => {
      const segment = createSegment({
        originalText: '<script>alert("xss")</script> text',
      });
      const { container } = render(
        <SegmentRow segment={segment} searchQuery="text" />
      );

      // The script tag should be rendered as text, not executed
      expect(container.querySelector('script')).toBeNull();
      expect(container.textContent).toContain('<script>');
    });

    it('does not highlight when searchQuery is empty', () => {
      const segment = createSegment({ originalText: 'テストテキスト' });
      const { container } = render(
        <SegmentRow segment={segment} searchQuery="" />
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(0);
    });

    it('does not highlight when searchQuery is not provided', () => {
      const segment = createSegment({ originalText: 'テストテキスト' });
      const { container } = render(<SegmentRow segment={segment} />);

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(0);
    });

    it('handles regex special characters in search query safely', () => {
      const segment = createSegment({ originalText: 'price is $10.00 (USD)' });
      const { container } = render(
        <SegmentRow segment={segment} searchQuery="$10.00" />
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(1);
      expect(marks[0].textContent).toBe('$10.00');
    });
  });
});

describe('highlightText', () => {
  it('returns plain text when query is empty', () => {
    const result = highlightText('hello world', '');
    expect(result).toBe('hello world');
  });

  it('returns plain text when no match found', () => {
    const result = highlightText('hello world', 'xyz');
    expect(result).toBe('hello world');
  });
});
