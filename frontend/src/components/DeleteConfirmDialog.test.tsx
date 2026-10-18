import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

describe('DeleteConfirmDialog', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it('does not render when isOpen is false', () => {
    render(
      <DeleteConfirmDialog
        isOpen={false}
        title="メディアファイルの削除"
        resourceName="会議録音.mp3"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with title and resource name when open', () => {
    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="メディアファイルの削除"
        resourceName="会議録音.mp3"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('メディアファイルの削除')).toBeInTheDocument();
    expect(screen.getByText('会議録音.mp3')).toBeInTheDocument();
  });

  it('displays default warning message about irreversibility', () => {
    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('この操作は取り消せません。削除されたデータは復元できません。')).toBeInTheDocument();
  });

  it('displays custom warning message when provided', () => {
    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="Transcription の削除"
        resourceName="セッション A"
        warningMessage="関連する Segment・Correction・ConsensusResult がすべて削除されます。"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText('関連する Segment・Correction・ConsensusResult がすべて削除されます。'),
    ).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();

    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when delete button is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it('shows loading state during deletion', async () => {
    const onConfirm = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(screen.getByText('削除中...')).toBeInTheDocument();
    });

    // Both buttons should be disabled during deletion
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  });

  it('shows error message when deletion fails', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('削除に失敗しました。再試行してください。'));

    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('削除に失敗しました。再試行してください。')).toBeInTheDocument();
    });
  });

  it('has proper ARIA attributes for modal dialog', () => {
    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'delete-dialog-title');
  });

  it('calls onCancel when backdrop is clicked', async () => {
    const onCancel = vi.fn();

    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    // Click the backdrop (the element with aria-hidden="true")
    const backdrop = screen.getByRole('dialog').querySelector('[aria-hidden="true"]');
    if (backdrop) {
      await user.click(backdrop);
    }

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('resets error state when dialog is reopened', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('エラー'));

    const { rerender } = render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Close and reopen
    rerender(
      <DeleteConfirmDialog
        isOpen={false}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    rerender(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        resourceName="test-file.mp3"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
