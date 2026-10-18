import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SessionReopenControls } from './SessionReopenControls';
import type { ReviewSession, ReopenSessionResult } from '../types/session';

function createSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    sessionId: 'session-1',
    transcriptionJobId: 'job-1',
    name: 'テストセッション',
    status: 'COMPLETED',
    assignedTeamId: 'team-1',
    assignedReviewerCount: 0,
    consensusThreshold: 70,
    partialAggregationEnabled: false,
    createdAt: '2024-06-15T10:30:00.000Z',
    updatedAt: '2024-06-15T10:30:00.000Z',
    ...overrides,
  };
}

const successResult: ReopenSessionResult = {
  sessionId: 'session-1',
  status: 'IN_PROGRESS',
};

describe('SessionReopenControls', () => {
  it('has no accessibility violations (button and expanded confirmation)', async () => {
    const { container } = render(
      <SessionReopenControls
        session={createSession()}
        userRole="TEAM_LEADER"
        onReopen={vi.fn()}
      />
    );

    // Expand the confirmation step so the dialog region is also audited.
    await userEvent.click(screen.getByRole('button', { name: '進行中に戻す' }));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('does not render anything for a reviewer', () => {
    const { container } = render(
      <SessionReopenControls
        session={createSession()}
        userRole="REVIEWER"
        onReopen={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: /進行中に戻す/ })
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the reopen button for ADMIN', () => {
    render(
      <SessionReopenControls
        session={createSession()}
        userRole="ADMIN"
        onReopen={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: '進行中に戻す' })
    ).toBeInTheDocument();
  });

  it('renders the reopen button for TEAM_LEADER', () => {
    render(
      <SessionReopenControls
        session={createSession()}
        userRole="TEAM_LEADER"
        onReopen={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: '進行中に戻す' })
    ).toBeInTheDocument();
  });

  it('disables the button and shows supplemental text for a non-COMPLETED session', () => {
    render(
      <SessionReopenControls
        session={createSession({ status: 'IN_PROGRESS' })}
        userRole="ADMIN"
        onReopen={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: '進行中に戻す' })
    ).toBeDisabled();
    expect(
      screen.getByText('完了したセッションのみ差し戻せます。')
    ).toBeInTheDocument();
  });

  it('requires confirmation before calling onReopen and cancels cleanly', async () => {
    const onReopen = vi.fn().mockResolvedValue(successResult);
    render(
      <SessionReopenControls
        session={createSession()}
        userRole="ADMIN"
        onReopen={onReopen}
      />
    );

    // Opening the confirmation must NOT call the API yet.
    await userEvent.click(screen.getByRole('button', { name: '進行中に戻す' }));
    expect(onReopen).not.toHaveBeenCalled();
    expect(screen.getByText(/確定済みの結果は保持されます/)).toBeInTheDocument();

    // Cancelling closes the confirmation without calling the API.
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onReopen).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/確定済みの結果は保持されます/)
    ).not.toBeInTheDocument();
  });

  it('calls onReopen with the sessionId and shows a Japanese success message', async () => {
    const onReopen = vi.fn().mockResolvedValue(successResult);
    render(
      <SessionReopenControls
        session={createSession()}
        userRole="TEAM_LEADER"
        onReopen={onReopen}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '進行中に戻す' }));
    await userEvent.click(screen.getByRole('button', { name: '実行する' }));

    await waitFor(() => expect(onReopen).toHaveBeenCalledWith('session-1'));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('進行中に戻しました。');
  });

  it('surfaces a Japanese error message when onReopen rejects', async () => {
    const onReopen = vi
      .fn()
      .mockRejectedValue(new Error('このセッションを差し戻す権限がありません。'));
    render(
      <SessionReopenControls
        session={createSession()}
        userRole="ADMIN"
        onReopen={onReopen}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '進行中に戻す' }));
    await userEvent.click(screen.getByRole('button', { name: '実行する' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'このセッションを差し戻す権限がありません。'
      )
    );
  });
});
