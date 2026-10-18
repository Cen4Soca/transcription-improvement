import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TeamManagement } from './TeamManagement';
import type { Team, TeamAssignment } from '../types/team';
import type { User } from '../types/user';
import type { ReviewSession } from '../types/session';

const mockTeams: Team[] = [
  {
    teamId: 'team-1',
    name: '翻訳チームA',
    createdBy: 'user-1',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    teamId: 'team-2',
    name: '校閲チームB',
    createdBy: 'user-1',
    createdAt: '2024-01-02T00:00:00.000Z',
  },
];

const mockUsers: User[] = [
  {
    userId: 'user-1',
    email: 'admin@example.com',
    displayName: '管理者太郎',
    role: 'ADMIN',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    userId: 'user-2',
    email: 'reviewer@example.com',
    displayName: 'レビュアー花子',
    role: 'REVIEWER',
    isActive: true,
    createdAt: '2024-01-02T00:00:00.000Z',
  },
  {
    userId: 'user-3',
    email: 'leader@example.com',
    displayName: 'リーダー次郎',
    role: 'TEAM_LEADER',
    isActive: true,
    createdAt: '2024-01-03T00:00:00.000Z',
  },
];

const mockSessions: ReviewSession[] = [
  {
    sessionId: 'session-1',
    transcriptionJobId: 'job-1',
    name: 'セッション1',
    status: 'PENDING',
    assignedReviewerCount: 3,
    consensusThreshold: 70,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

const mockTeamMembers: Record<string, string[]> = {
  'team-1': ['user-1', 'user-2'],
  'team-2': [],
};

const mockTeamAssignments: TeamAssignment[] = [
  {
    teamId: 'team-1',
    sessionId: 'session-1',
    assignedBy: 'user-1',
    assignedAt: '2024-01-01T00:00:00.000Z',
  },
];

const defaultProps = {
  teams: mockTeams,
  users: mockUsers,
  sessions: mockSessions,
  teamMembers: mockTeamMembers,
  teamAssignments: mockTeamAssignments,
};

describe('TeamManagement', () => {
  it('renders team list with member count', () => {
    render(<TeamManagement {...defaultProps} />);

    expect(screen.getByText('翻訳チームA')).toBeInTheDocument();
    expect(screen.getByText('2名')).toBeInTheDocument();
    expect(screen.getByText('校閲チームB')).toBeInTheDocument();
    expect(screen.getByText('0名')).toBeInTheDocument();
  });

  it('shows empty message when no teams', () => {
    render(<TeamManagement {...defaultProps} teams={[]} />);
    expect(screen.getByText('チームがありません')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<TeamManagement {...defaultProps} isLoading={true} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('opens create team form and calls onCreateTeam', async () => {
    const user = userEvent.setup();
    const onCreateTeam = vi.fn();
    render(<TeamManagement {...defaultProps} onCreateTeam={onCreateTeam} />);

    await user.click(screen.getByText('チーム作成'));
    expect(screen.getByLabelText('チーム名')).toBeInTheDocument();

    await user.type(screen.getByLabelText('チーム名'), '新チーム');
    await user.click(screen.getByText('作成'));

    expect(onCreateTeam).toHaveBeenCalledWith('新チーム');
  });

  it('allows editing team name', async () => {
    const user = userEvent.setup();
    const onEditTeam = vi.fn();
    render(<TeamManagement {...defaultProps} onEditTeam={onEditTeam} />);

    const editButtons = screen.getAllByText('編集');
    await user.click(editButtons[0]);

    const input = screen.getByLabelText('チーム名を編集');
    await user.clear(input);
    await user.type(input, '新しいチーム名');
    await user.click(screen.getByText('保存'));

    expect(onEditTeam).toHaveBeenCalledWith('team-1', '新しいチーム名');
  });

  it('shows delete confirmation dialog and calls onDeleteTeam', async () => {
    const user = userEvent.setup();
    const onDeleteTeam = vi.fn();
    render(<TeamManagement {...defaultProps} onDeleteTeam={onDeleteTeam} />);

    const deleteButtons = screen.getAllByText('削除');
    await user.click(deleteButtons[0]);

    expect(screen.getByText('チーム削除の確認')).toBeInTheDocument();

    await user.click(screen.getByText('削除する'));
    expect(onDeleteTeam).toHaveBeenCalledWith('team-1');
  });

  it('cancels delete confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<TeamManagement {...defaultProps} />);

    const deleteButtons = screen.getAllByText('削除');
    await user.click(deleteButtons[0]);

    expect(screen.getByText('チーム削除の確認')).toBeInTheDocument();

    await user.click(screen.getByText('キャンセル'));
    expect(screen.queryByText('チーム削除の確認')).not.toBeInTheDocument();
  });

  it('expands team to show members', async () => {
    const user = userEvent.setup();
    render(<TeamManagement {...defaultProps} />);

    await user.click(screen.getByText('翻訳チームA'));

    expect(screen.getByText('管理者太郎')).toBeInTheDocument();
    expect(screen.getByText('レビュアー花子')).toBeInTheDocument();
  });

  it('shows assignment section with assigned sessions', async () => {
    const user = userEvent.setup();
    render(<TeamManagement {...defaultProps} />);

    const assignButtons = screen.getAllByText('割り当て');
    await user.click(assignButtons[0]);

    expect(screen.getByText('セッション割り当て')).toBeInTheDocument();
    expect(screen.getByText('セッション1')).toBeInTheDocument();
  });

  it('calls onAssignSession when assigning a session', async () => {
    const user = userEvent.setup();
    const onAssignSession = vi.fn();
    render(
      <TeamManagement
        {...defaultProps}
        teamAssignments={[]}
        onAssignSession={onAssignSession}
      />
    );

    const assignButtons = screen.getAllByText('割り当て');
    await user.click(assignButtons[0]);

    const select = screen.getByLabelText('割り当てるセッションを選択');
    await user.selectOptions(select, 'session-1');
    await user.click(screen.getByRole('button', { name: '割り当て' }));

    expect(onAssignSession).toHaveBeenCalledWith('team-1', 'session-1');
  });

  it('calls onRemoveMember when removing a member', async () => {
    const user = userEvent.setup();
    const onRemoveMember = vi.fn();
    render(<TeamManagement {...defaultProps} onRemoveMember={onRemoveMember} />);

    await user.click(screen.getByText('翻訳チームA'));

    const removeButtons = screen.getAllByLabelText(/をチームから削除/);
    await user.click(removeButtons[0]);

    expect(onRemoveMember).toHaveBeenCalledWith('team-1', 'user-1');
  });

  it('calls onUnassignSession when unassigning an assigned session', async () => {
    const user = userEvent.setup();
    const onUnassignSession = vi.fn();
    render(
      <TeamManagement {...defaultProps} onUnassignSession={onUnassignSession} />
    );

    const assignButtons = screen.getAllByText('割り当て');
    await user.click(assignButtons[0]);

    // team-1 has session-1 assigned via mockTeamAssignments.
    expect(screen.getByText('割り当て済み')).toBeInTheDocument();
    await user.click(screen.getByLabelText('セッション1の割り当てを解除'));

    expect(onUnassignSession).toHaveBeenCalledWith('team-1', 'session-1');
  });

  it('shows "割り当て可能なセッションがありません" when there are no assignable sessions', async () => {
    const user = userEvent.setup();
    // All sessions already assigned → no candidates remain for team-1.
    render(<TeamManagement {...defaultProps} />);

    const assignButtons = screen.getAllByText('割り当て');
    await user.click(assignButtons[0]);

    expect(
      screen.getByText('割り当て可能なセッションがありません')
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<TeamManagement {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
