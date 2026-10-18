import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { DraftRecoveryDialog } from './DraftRecoveryDialog';
import type { DraftInfo } from '../services/draft-storage';

describe('DraftRecoveryDialog', () => {
  let user: ReturnType<typeof userEvent.setup>;
  const mockDrafts: DraftInfo[] = [
    { sessionId: 's1', segmentId: 'seg1', text: 'Draft text 1', savedAt: '2024-01-01T00:00:00.000Z' },
    { sessionId: 's1', segmentId: 'seg2', text: 'Draft text 2', savedAt: '2024-01-01T00:01:00.000Z' },
  ];

  beforeEach(() => {
    user = userEvent.setup();
  });

  it('does not render when isOpen is false', () => {
    render(
      <DraftRecoveryDialog
        isOpen={false}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render when drafts array is empty', () => {
    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={[]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with title when open with drafts', () => {
    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('未保存の編集内容があります')).toBeInTheDocument();
  });

  it('displays the number of draft segments', () => {
    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText('対象セグメント（2件）:')).toBeInTheDocument();
  });

  it('displays segment IDs in the list', () => {
    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText('seg1')).toBeInTheDocument();
    expect(screen.getByText('seg2')).toBeInTheDocument();
  });

  it('truncates long draft text with ellipsis', () => {
    const longDrafts: DraftInfo[] = [
      {
        sessionId: 's1',
        segmentId: 'seg1',
        text: 'A'.repeat(60),
        savedAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={longDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText(`${'A'.repeat(50)}...`)).toBeInTheDocument();
  });

  it('calls onRestore with drafts when 復元する button is clicked', async () => {
    const onRestore = vi.fn();

    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={onRestore}
        onDiscard={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '復元する' }));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(mockDrafts);
  });

  it('calls onDiscard when 破棄する button is clicked', async () => {
    const onDiscard = vi.fn();

    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    await user.click(screen.getByRole('button', { name: '破棄する' }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('calls onDiscard when Escape key is pressed', async () => {
    const onDiscard = vi.fn();

    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    await user.keyboard('{Escape}');

    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('has proper ARIA attributes for modal dialog', () => {
    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'draft-recovery-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'draft-recovery-dialog-description');
  });

  it('has an accessible list of drafts', () => {
    render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByRole('list', { name: '未保存ドラフト一覧' })).toBeInTheDocument();
  });

  it('passes axe accessibility checks', async () => {
    const { container } = render(
      <DraftRecoveryDialog
        isOpen={true}
        drafts={mockDrafts}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
