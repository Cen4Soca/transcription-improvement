import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SessionAssignmentControls } from './SessionAssignmentControls';
import type { ReviewSession } from '../types/session';
import type { Team, TeamMembership } from '../types/team';

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

const teams: Team[] = [
  { teamId: 'team-1', name: 'チームA', createdBy: 'admin', createdAt: '2024-01-01T00:00:00.000Z' },
  { teamId: 'team-2', name: 'チームB', createdBy: 'admin', createdAt: '2024-01-01T00:00:00.000Z' },
];

const members: TeamMembership[] = [
  { teamId: 'team-1', userId: 'user-a', joinedAt: '2024-01-01T00:00:00.000Z', displayName: 'Alice', email: 'a@test.com' },
  { teamId: 'team-1', userId: 'user-b', joinedAt: '2024-01-01T00:00:00.000Z', displayName: 'Bob', email: 'b@test.com' },
];

describe('SessionAssignmentControls', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <SessionAssignmentControls
        session={createSession()}
        userRole="TEAM_LEADER"
        currentUserId="leader-1"
        onClaim={vi.fn()}
        onAssign={vi.fn()}
        teams={teams}
        loadTeamMembers={vi.fn().mockResolvedValue(members)}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows a claim button for an unclaimed session and calls onClaim', async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionAssignmentControls
        session={createSession()}
        userRole="REVIEWER"
        currentUserId="reviewer-1"
        onClaim={onClaim}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '引き受ける' }));

    expect(onClaim).toHaveBeenCalledWith('session-1');
  });

  it('hides the claim button when already claimed', () => {
    render(
      <SessionAssignmentControls
        session={createSession({ assignedUserId: 'other-user' })}
        userRole="REVIEWER"
        currentUserId="reviewer-1"
        onClaim={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '引き受ける' })).not.toBeInTheDocument();
    expect(screen.getByText(/割り当て済み/)).toBeInTheDocument();
  });

  it('marks a session claimed by the current user', () => {
    render(
      <SessionAssignmentControls
        session={createSession({ assignedUserId: 'reviewer-1' })}
        userRole="REVIEWER"
        currentUserId="reviewer-1"
        onClaim={vi.fn()}
      />
    );

    expect(screen.getByText('自分が引き受け中')).toBeInTheDocument();
  });

  it('does not show assign controls for a reviewer', () => {
    render(
      <SessionAssignmentControls
        session={createSession()}
        userRole="REVIEWER"
        currentUserId="reviewer-1"
        onClaim={vi.fn()}
        onAssign={vi.fn()}
        teams={teams}
      />
    );

    expect(screen.queryByRole('button', { name: '担当者を割り当て' })).not.toBeInTheDocument();
  });

  it('assigns a session to a team via dropdown (default mode)', async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionAssignmentControls
        session={createSession()}
        userRole="TEAM_LEADER"
        currentUserId="leader-1"
        onAssign={onAssign}
        teams={teams}
        loadTeamMembers={vi.fn().mockResolvedValue(members)}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '担当者を割り当て' }));
    await userEvent.selectOptions(screen.getByLabelText('チーム'), 'team-2');
    await userEvent.click(screen.getByRole('button', { name: '割り当てを保存' }));

    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledWith('session-1', { assignedTeamId: 'team-2' })
    );
  });

  it('assigns a session to a member via team + member dropdowns', async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined);
    const loadTeamMembers = vi.fn().mockResolvedValue(members);
    render(
      <SessionAssignmentControls
        session={createSession()}
        userRole="ADMIN"
        currentUserId="admin-1"
        onAssign={onAssign}
        teams={teams}
        loadTeamMembers={loadTeamMembers}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '担当者を割り当て' }));
    await userEvent.click(screen.getByRole('radio', { name: 'ユーザーに割り当て' }));
    await userEvent.selectOptions(screen.getByLabelText('チーム'), 'team-1');

    // Members load after selecting the team
    await waitFor(() => expect(loadTeamMembers).toHaveBeenCalledWith('team-1'));
    await screen.findByRole('option', { name: /Alice/ });

    await userEvent.selectOptions(screen.getByLabelText('メンバー'), 'user-b');
    await userEvent.click(screen.getByRole('button', { name: '割り当てを保存' }));

    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledWith('session-1', { assignedUserId: 'user-b' })
    );
  });

  it('shows a validation error when saving a team assignment with no team selected', async () => {
    const onAssign = vi.fn();
    render(
      <SessionAssignmentControls
        session={createSession()}
        userRole="ADMIN"
        currentUserId="admin-1"
        onAssign={onAssign}
        teams={teams}
        loadTeamMembers={vi.fn().mockResolvedValue(members)}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '担当者を割り当て' }));
    await userEvent.click(screen.getByRole('button', { name: '割り当てを保存' }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('surfaces an error thrown by onClaim', async () => {
    const onClaim = vi.fn().mockRejectedValue(new Error('既に引き受け済み'));
    render(
      <SessionAssignmentControls
        session={createSession()}
        userRole="REVIEWER"
        currentUserId="reviewer-1"
        onClaim={onClaim}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '引き受ける' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('既に引き受け済み')
    );
  });

  describe('joinable scope', () => {
    it('has no accessibility violations in joinable scope', async () => {
      const { container } = render(
        <SessionAssignmentControls
          session={createSession({ assignedUserId: 'uploader-1' })}
          userRole="REVIEWER"
          currentUserId="reviewer-1"
          scope="joinable"
          onClaim={vi.fn()}
        />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('shows a 参加 button for an auto-generated session claimed by someone else', async () => {
      const onClaim = vi.fn().mockResolvedValue(undefined);
      render(
        <SessionAssignmentControls
          // Auto-generated session: uploader is in assignedUserId, still PENDING,
          // assigned to a team, and the current reviewer is not the uploader.
          session={createSession({ assignedUserId: 'uploader-1' })}
          userRole="REVIEWER"
          currentUserId="reviewer-1"
          scope="joinable"
          onClaim={onClaim}
        />
      );

      await userEvent.click(screen.getByRole('button', { name: '参加' }));

      expect(onClaim).toHaveBeenCalledWith('session-1');
      // The legacy label must not be used in joinable scope.
      expect(screen.queryByRole('button', { name: '引き受ける' })).not.toBeInTheDocument();
    });

    it('hides the 参加 button when the current user is the uploader', () => {
      render(
        <SessionAssignmentControls
          session={createSession({ assignedUserId: 'reviewer-1' })}
          userRole="REVIEWER"
          currentUserId="reviewer-1"
          scope="joinable"
          onClaim={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: '参加' })).not.toBeInTheDocument();
    });

    it('hides the 参加 button for a non-PENDING session', () => {
      render(
        <SessionAssignmentControls
          session={createSession({ status: 'IN_PROGRESS', assignedUserId: 'uploader-1' })}
          userRole="REVIEWER"
          currentUserId="reviewer-1"
          scope="joinable"
          onClaim={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: '参加' })).not.toBeInTheDocument();
    });
  });

  it('keeps default-scope behaviour unchanged: claim button still hidden when claimed', () => {
    // Regression guard: with no scope prop, an auto-generated (assignedUserId set)
    // PENDING session must NOT show a button — the existing / list behaviour.
    render(
      <SessionAssignmentControls
        session={createSession({ assignedUserId: 'uploader-1' })}
        userRole="REVIEWER"
        currentUserId="reviewer-1"
        onClaim={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '引き受ける' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '参加' })).not.toBeInTheDocument();
  });
});
