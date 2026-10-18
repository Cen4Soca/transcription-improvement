import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminPage } from './AdminPage';
import type { User } from '../types/user';
import type { Team, TeamAssignment } from '../types/team';
import type { ReviewSession } from '../types/session';

const mockUsers: User[] = [
  {
    userId: 'user-1',
    email: 'admin@example.com',
    displayName: '管理者太郎',
    role: 'ADMIN',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];

const mockTeams: Team[] = [
  {
    teamId: 'team-1',
    name: 'テストチーム',
    createdBy: 'user-1',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];

const mockSessions: ReviewSession[] = [];
const mockTeamMembers: Record<string, string[]> = { 'team-1': ['user-1'] };
const mockTeamAssignments: TeamAssignment[] = [];

const defaultProps = {
  users: mockUsers,
  teams: mockTeams,
  sessions: mockSessions,
  teamMembers: mockTeamMembers,
  teamAssignments: mockTeamAssignments,
};

describe('AdminPage', () => {
  it('renders with tab navigation', () => {
    render(<AdminPage {...defaultProps} />);

    expect(screen.getByText('管理画面')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ユーザー管理' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'チーム管理' })).toBeInTheDocument();
  });

  it('shows user management tab by default', () => {
    render(<AdminPage {...defaultProps} />);

    expect(screen.getByRole('tab', { name: 'ユーザー管理' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('ユーザー一覧')).toBeInTheDocument();
  });

  it('switches to team management tab', async () => {
    const user = userEvent.setup();
    render(<AdminPage {...defaultProps} />);

    await user.click(screen.getByRole('tab', { name: 'チーム管理' }));

    expect(screen.getByRole('tab', { name: 'チーム管理' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('チーム一覧')).toBeInTheDocument();
  });

  it('displays user data in user management tab', () => {
    render(<AdminPage {...defaultProps} />);

    expect(screen.getByText('管理者太郎')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
  });

  it('displays team data in team management tab', async () => {
    const user = userEvent.setup();
    render(<AdminPage {...defaultProps} />);

    await user.click(screen.getByRole('tab', { name: 'チーム管理' }));

    expect(screen.getByText('テストチーム')).toBeInTheDocument();
    expect(screen.getByText('1名')).toBeInTheDocument();
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(<AdminPage {...defaultProps} />);

    expect(screen.getByRole('main', { name: '管理画面' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: '管理画面タブ' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('switches to IP allowlist tab', async () => {
    const user = userEvent.setup();
    render(<AdminPage {...defaultProps} />);

    await user.click(screen.getByRole('tab', { name: 'IPアドレス制限' }));

    expect(screen.getByRole('tab', { name: 'IPアドレス制限' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('IPアドレス許可リスト')).toBeInTheDocument();
  });

  it('switches to audit logs tab', async () => {
    const user = userEvent.setup();
    render(<AdminPage {...defaultProps} />);

    await user.click(screen.getByRole('tab', { name: '監査ログ' }));

    expect(screen.getByRole('tab', { name: '監査ログ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('監査ログ管理')).toBeInTheDocument();
  });
});
