import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import i18n from '../i18n';
import { UserManagement } from './UserManagement';
import type { User } from '../types/user';

const tu = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:user.${key}`, opts);
const tc = (key: string) => i18n.t(`common:${key}`);

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
    email: 'disabled@example.com',
    displayName: '無効ユーザー',
    role: 'REVIEWER',
    isActive: false,
    createdAt: '2024-01-03T00:00:00.000Z',
  },
];

describe('UserManagement', () => {
  it('renders user list with name, email, role, and status', () => {
    render(<UserManagement users={mockUsers} />);

    expect(screen.getByText('管理者太郎')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText(tu('role.ADMIN'))).toBeInTheDocument();

    expect(screen.getByText('レビュアー花子')).toBeInTheDocument();
    expect(screen.getAllByText(tu('role.REVIEWER'))).toHaveLength(2);

    // Active/inactive status badges
    const activeBadges = screen.getAllByText(tu('status.active'));
    expect(activeBadges).toHaveLength(2);
    expect(screen.getByText(tu('status.inactive'))).toBeInTheDocument();
  });

  it('shows empty message when no users', () => {
    render(<UserManagement users={[]} />);
    expect(screen.getByText(tu('emptyState'))).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<UserManagement users={[]} isLoading={true} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('opens create user form when button is clicked', async () => {
    const user = userEvent.setup();
    render(<UserManagement users={mockUsers} />);

    await user.click(screen.getByText(tu('addUser')));

    expect(screen.getByLabelText(tu('email'))).toBeInTheDocument();
    expect(screen.getByLabelText(tu('displayName'))).toBeInTheDocument();
    expect(screen.getByLabelText(tu('roleLabel'))).toBeInTheDocument();
  });

  it('calls onCreateUser with form data on submit', async () => {
    const user = userEvent.setup();
    const onCreateUser = vi.fn();
    render(<UserManagement users={mockUsers} onCreateUser={onCreateUser} />);

    await user.click(screen.getByText(tu('addUser')));
    await user.type(screen.getByLabelText(tu('email')), 'new@example.com');
    await user.type(screen.getByLabelText(tu('displayName')), '新規ユーザー');
    await user.click(screen.getByText(tu('register')));

    expect(onCreateUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      displayName: '新規ユーザー',
      role: 'REVIEWER',
    });
  });

  it('shows disable confirmation dialog and calls onDisableUser', async () => {
    const user = userEvent.setup();
    const onDisableUser = vi.fn();
    render(<UserManagement users={mockUsers} onDisableUser={onDisableUser} />);

    const disableButtons = screen.getAllByText(tu('disable'));
    await user.click(disableButtons[0]);

    expect(screen.getByText(tu('disableDialogTitle'))).toBeInTheDocument();

    await user.click(screen.getByText(tu('disableConfirm')));
    expect(onDisableUser).toHaveBeenCalledWith('user-1');
  });

  it('cancels disable confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<UserManagement users={mockUsers} />);

    const disableButtons = screen.getAllByText(tu('disable'));
    await user.click(disableButtons[0]);

    expect(screen.getByText(tu('disableDialogTitle'))).toBeInTheDocument();

    await user.click(screen.getByText(tc('cancel')));
    expect(screen.queryByText(tu('disableDialogTitle'))).not.toBeInTheDocument();
  });

  it('does not show disable button for already disabled users', () => {
    render(<UserManagement users={mockUsers} />);

    // Only 2 active users should have disable buttons
    const disableButtons = screen.getAllByText(tu('disable'));
    expect(disableButtons).toHaveLength(2);
  });

  it('shows enable button only for disabled users', () => {
    render(<UserManagement users={mockUsers} />);

    // Only the single disabled user (user-3) should have an enable button
    const enableButtons = screen.getAllByText(tu('enable'));
    expect(enableButtons).toHaveLength(1);
  });

  it('shows enable confirmation dialog and calls onEnableUser', async () => {
    const user = userEvent.setup();
    const onEnableUser = vi.fn();
    render(<UserManagement users={mockUsers} onEnableUser={onEnableUser} />);

    await user.click(screen.getByText(tu('enable')));

    expect(screen.getByText(tu('enableDialogTitle'))).toBeInTheDocument();

    await user.click(screen.getByText(tu('enableConfirm')));
    expect(onEnableUser).toHaveBeenCalledWith('user-3');
  });

  it('cancels enable confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<UserManagement users={mockUsers} />);

    await user.click(screen.getByText(tu('enable')));

    expect(screen.getByText(tu('enableDialogTitle'))).toBeInTheDocument();

    await user.click(screen.getByText(tc('cancel')));
    expect(screen.queryByText(tu('enableDialogTitle'))).not.toBeInTheDocument();
  });

  it('displays role badges with correct labels', () => {
    render(<UserManagement users={mockUsers} />);

    expect(screen.getByText(tu('role.ADMIN'))).toBeInTheDocument();
    // Two REVIEWER users should have 'レビュアー' badges
    const reviewerBadges = screen.getAllByText(tu('role.REVIEWER'));
    expect(reviewerBadges.length).toBe(2);
  });

  it('shows edit button only when onEditUser is provided', () => {
    const { rerender } = render(<UserManagement users={mockUsers} />);
    expect(screen.queryByLabelText(tu('editAriaLabel', { name: '管理者太郎' }))).not.toBeInTheDocument();

    rerender(<UserManagement users={mockUsers} onEditUser={vi.fn().mockResolvedValue(null)} />);
    expect(screen.getByLabelText(tu('editAriaLabel', { name: '管理者太郎' }))).toBeInTheDocument();
  });

  it('submits only changed fields when editing a user', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText(tu('editAriaLabel', { name: '管理者太郎' })));

    const nameInput = screen.getByLabelText(tu('displayName'));
    await user.clear(nameInput);
    await user.type(nameInput, '管理者次郎');
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(onEditUser).toHaveBeenCalledWith('user-1', { displayName: '管理者次郎' });
  });

  it('shows an error message when edit fails', async () => {
    const user = userEvent.setup();
    const onEditUser = vi
      .fn()
      .mockResolvedValue({ code: 'VALIDATION_ERROR', message: 'このメールアドレスは既に使用されています。' });
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText(tu('editAriaLabel', { name: '管理者太郎' })));
    const emailInput = screen.getByLabelText(tu('email'));
    await user.clear(emailInput);
    await user.type(emailInput, 'reviewer@example.com');
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(await screen.findByRole('alert')).toHaveTextContent('このメールアドレスは既に使用されています。');
  });

  it('calls onEditUser with the new role when the role is changed', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText(tu('editAriaLabel', { name: 'レビュアー花子' })));

    const roleSelect = screen.getByLabelText(tu('roleLabel'));
    await user.selectOptions(roleSelect, 'TEAM_LEADER');
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(onEditUser).toHaveBeenCalledWith('user-2', { role: 'TEAM_LEADER' });
  });

  it('does not include role in the payload when the role is unchanged', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText(tu('editAriaLabel', { name: 'レビュアー花子' })));

    const nameInput = screen.getByLabelText(tu('displayName'));
    await user.clear(nameInput);
    await user.type(nameInput, 'レビュアー次郎');
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(onEditUser).toHaveBeenCalledWith('user-2', { displayName: 'レビュアー次郎' });
    const payload = onEditUser.mock.calls[0][1];
    expect(payload).not.toHaveProperty('role');
  });

  it('disables the role select for the logged-in admin (self-demotion guard)', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(
      <UserManagement users={mockUsers} onEditUser={onEditUser} currentUserId="user-1" />
    );

    await user.click(screen.getByLabelText(tu('editAriaLabel', { name: '管理者太郎' })));

    const roleSelect = screen.getByLabelText(tu('roleLabel'));
    expect(roleSelect).toBeDisabled();
  });

  it('shows an error and does not call onEditUser when a self-admin submits a demotion', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(
      <UserManagement users={mockUsers} onEditUser={onEditUser} currentUserId="user-1" />
    );

    await user.click(screen.getByLabelText(tu('editAriaLabel', { name: '管理者太郎' })));

    // The select is disabled in the UI, so drive the guard via the form state by
    // enabling the control before changing it, mirroring a bypass attempt.
    const roleSelect = screen.getByLabelText(tu('roleLabel')) as HTMLSelectElement;
    roleSelect.removeAttribute('disabled');
    await user.selectOptions(roleSelect, 'REVIEWER');
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      tu('validation.selfAdmin')
    );
    expect(onEditUser).not.toHaveBeenCalled();
  });

  it('has no accessibility violations when the edit form is open', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <UserManagement users={mockUsers} onEditUser={onEditUser} />
    );

    await user.click(screen.getByLabelText(tu('editAriaLabel', { name: 'レビュアー花子' })));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('UserManagement - workload columns', () => {
  const workload = {
    'user-2': {
      userId: 'user-2', displayName: 'レビュアー花子', email: 'reviewer@example.com',
      role: 'REVIEWER' as const, isActive: true,
      assignedCount: 4, inProgressCount: 2, stalledCount: 1,
    },
  };

  it('does not show workload columns when workload is not provided', () => {
    render(<UserManagement users={mockUsers} />);
    expect(screen.queryByText(i18n.t('monitoring:user.column.assigned'))).not.toBeInTheDocument();
  });

  it('shows assigned / in-progress / stalled columns, defaulting to 0 for users without data', () => {
    render(<UserManagement users={mockUsers} workload={workload} />);
    expect(screen.getByRole('columnheader', { name: i18n.t('monitoring:user.column.assigned') })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: i18n.t('monitoring:user.column.inProgress') })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: i18n.t('monitoring:user.column.stalled') })).toBeInTheDocument();

    const row = screen.getByText('レビュアー花子').closest('tr')!;
    expect(row).toHaveTextContent('4');
    expect(row).toHaveTextContent('2');
    expect(row).toHaveTextContent('1');

    const adminRow = screen.getByText('管理者太郎').closest('tr')!;
    // cells: email, role, status, assigned, inProgress, stalled, actions (name is a th-less td at index 0)
    const cells = adminRow.querySelectorAll('td');
    expect([cells[4], cells[5], cells[6]].map((c) => c?.textContent)).toEqual(['0', '0', '0']);
  });

  it('expands a user row to load that user’s sessions', async () => {
    const loadUserSessions = vi.fn().mockResolvedValue({ ok: true, value: { data: { items: [] } } });
    render(<UserManagement users={mockUsers} workload={workload} loadUserSessions={loadUserSessions} />);

    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('monitoring:user.expandAriaLabel', { name: 'レビュアー花子' }) })
    );
    expect(await screen.findByText(i18n.t('monitoring:user.sessions.empty'))).toBeInTheDocument();
    expect(loadUserSessions).toHaveBeenCalledWith('user-2');
  });

  it('has no accessibility violations with workload columns', async () => {
    const { container } = render(
      <UserManagement
        users={mockUsers}
        workload={workload}
        loadUserSessions={vi.fn().mockResolvedValue({ ok: true, value: { data: { items: [] } } })}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
