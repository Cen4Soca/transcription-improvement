import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SessionAggregateControls } from './SessionAggregateControls';
import type { ReviewSession, ForceAggregateResult } from '../types/session';

function createSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    sessionId: 'session-1',
    transcriptionJobId: 'job-1',
    name: 'テストセッション',
    status: 'PENDING',
    assignedTeamId: 'team-1',
    assignedReviewerCount: 0,
    consensusThreshold: 70,
    partialAggregationEnabled: false,
    createdAt: '2024-06-15T10:30:00.000Z',
    updatedAt: '2024-06-15T10:30:00.000Z',
    ...overrides,
  };
}

const successResult: ForceAggregateResult = {
  sessionId: 'session-1',
  status: 'COMPLETED',
  totalReviewers: 2,
  confirmedCount: 1,
  conflictCount: 1,
};

describe('SessionAggregateControls', () => {
  it('has no accessibility violations (button and expanded confirmation)', async () => {
    const { container } = render(
      <SessionAggregateControls
        session={createSession()}
        userRole="TEAM_LEADER"
        onAggregate={vi.fn()}
      />
    );

    // Expand the confirmation step so the dialog region is also audited.
    await userEvent.click(
      screen.getByRole('button', { name: '強制集約して確定' })
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('does not render anything for a reviewer', () => {
    const { container } = render(
      <SessionAggregateControls
        session={createSession()}
        userRole="REVIEWER"
        onAggregate={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: /強制集約/ })
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the force-aggregate button for ADMIN', () => {
    render(
      <SessionAggregateControls
        session={createSession()}
        userRole="ADMIN"
        onAggregate={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: '強制集約して確定' })
    ).toBeInTheDocument();
  });

  it('renders the force-aggregate button for TEAM_LEADER', () => {
    render(
      <SessionAggregateControls
        session={createSession()}
        userRole="TEAM_LEADER"
        onAggregate={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: '強制集約して確定' })
    ).toBeInTheDocument();
  });

  it('disables the button for an already-COMPLETED session', () => {
    render(
      <SessionAggregateControls
        session={createSession({ status: 'COMPLETED' })}
        userRole="ADMIN"
        onAggregate={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: '強制集約して確定' })
    ).toBeDisabled();
    expect(
      screen.getByText('このセッションは既に完了しています。')
    ).toBeInTheDocument();
  });

  it('requires confirmation before calling onAggregate and cancels cleanly', async () => {
    const onAggregate = vi.fn().mockResolvedValue(successResult);
    render(
      <SessionAggregateControls
        session={createSession()}
        userRole="ADMIN"
        onAggregate={onAggregate}
      />
    );

    // Opening the confirmation must NOT call the API yet.
    await userEvent.click(
      screen.getByRole('button', { name: '強制集約して確定' })
    );
    expect(onAggregate).not.toHaveBeenCalled();
    expect(screen.getByText(/元に戻せません/)).toBeInTheDocument();

    // Cancelling closes the confirmation without calling the API.
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onAggregate).not.toHaveBeenCalled();
    expect(screen.queryByText(/元に戻せません/)).not.toBeInTheDocument();
  });

  it('calls onAggregate with the sessionId and shows a Japanese success summary', async () => {
    const onAggregate = vi.fn().mockResolvedValue(successResult);
    render(
      <SessionAggregateControls
        session={createSession()}
        userRole="TEAM_LEADER"
        onAggregate={onAggregate}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: '強制集約して確定' })
    );
    await userEvent.click(screen.getByRole('button', { name: '実行する' }));

    await waitFor(() => expect(onAggregate).toHaveBeenCalledWith('session-1'));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('確定 1 件');
    expect(status).toHaveTextContent('不一致 1 件');
    expect(status).toHaveTextContent('レビュアー 2 名');
  });

  it('surfaces a Japanese error message when onAggregate rejects', async () => {
    const onAggregate = vi
      .fn()
      .mockRejectedValue(new Error('このセッションは既に完了しています。'));
    render(
      <SessionAggregateControls
        session={createSession()}
        userRole="ADMIN"
        onAggregate={onAggregate}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: '強制集約して確定' })
    );
    await userEvent.click(screen.getByRole('button', { name: '実行する' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'このセッションは既に完了しています。'
      )
    );
  });
});
