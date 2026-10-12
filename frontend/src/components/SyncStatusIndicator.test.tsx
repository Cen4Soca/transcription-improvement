import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncStatusIndicator } from './SyncStatusIndicator';

describe('SyncStatusIndicator', () => {
  it('should not render when status is idle', () => {
    render(<SyncStatusIndicator status="idle" />);

    expect(screen.queryByTestId('sync-status-indicator')).not.toBeInTheDocument();
  });

  it('should display "同期中..." when status is syncing', () => {
    render(<SyncStatusIndicator status="syncing" />);

    const indicator = screen.getByTestId('sync-status-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent('同期中...');
  });

  it('should display "同期完了" when status is completed', () => {
    render(<SyncStatusIndicator status="completed" />);

    const indicator = screen.getByTestId('sync-status-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent('同期完了');
  });

  it('should display "同期失敗" with retry button when status is failed', () => {
    const onRetry = vi.fn();
    render(<SyncStatusIndicator status="failed" onRetry={onRetry} />);

    const indicator = screen.getByTestId('sync-status-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent('同期失敗');

    const retryButton = screen.getByRole('button', { name: '再試行' });
    expect(retryButton).toBeInTheDocument();
  });

  it('should call onRetry when retry button is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<SyncStatusIndicator status="failed" onRetry={onRetry} />);

    const retryButton = screen.getByRole('button', { name: '再試行' });
    await user.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should not show retry button when onRetry is not provided', () => {
    render(<SyncStatusIndicator status="failed" />);

    expect(screen.queryByRole('button', { name: '再試行' })).not.toBeInTheDocument();
  });

  it('should have role="status" for accessibility', () => {
    render(<SyncStatusIndicator status="syncing" />);

    const indicator = screen.getByRole('status');
    expect(indicator).toBeInTheDocument();
  });

  it('should have aria-live="polite" for screen readers', () => {
    render(<SyncStatusIndicator status="syncing" />);

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('aria-live', 'polite');
  });
});
