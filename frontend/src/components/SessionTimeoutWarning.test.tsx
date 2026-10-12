import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionTimeoutWarning } from './SessionTimeoutWarning';

describe('SessionTimeoutWarning', () => {
  it('should not render when visible is false', () => {
    render(
      <SessionTimeoutWarning
        visible={false}
        remainingMs={300000}
        onContinue={vi.fn()}
      />
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('should render warning dialog when visible is true', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        remainingMs={300000}
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('セッションがまもなく期限切れになります')).toBeInTheDocument();
    expect(screen.getByText('セッションがまもなく期限切れになります。続行しますか？')).toBeInTheDocument();
  });

  it('should display remaining time in MM:SS format', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        remainingMs={185000} // 3 minutes 5 seconds
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByText('残り 3:05')).toBeInTheDocument();
  });

  it('should display 0:00 when remaining time is 0', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        remainingMs={0}
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByText('残り 0:00')).toBeInTheDocument();
  });

  it('should call onContinue when Continue button is clicked', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    render(
      <SessionTimeoutWarning
        visible={true}
        remainingMs={300000}
        onContinue={onContinue}
      />
    );

    const continueButton = screen.getByRole('button', { name: '続行' });
    await user.click(continueButton);

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('should have proper accessibility attributes', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        remainingMs={300000}
        onContinue={vi.fn()}
      />
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'session-timeout-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'session-timeout-description');
  });

  it('should auto-focus the Continue button', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        remainingMs={300000}
        onContinue={vi.fn()}
      />
    );

    const continueButton = screen.getByRole('button', { name: '続行' });
    expect(continueButton).toHaveFocus();
  });
});
