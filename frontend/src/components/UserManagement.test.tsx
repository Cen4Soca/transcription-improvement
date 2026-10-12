import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { UserManagement } from './UserManagement';
import type { User } from '../types/user';

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
    expect(screen.getByText('管理者')).toBeInTheDocument();

    expect(screen.getByText('レビュアー花子')).toBeInTheDocument();
    expect(screen.getAllByText('レビュアー')).toHaveLength(2);

    // Active/inactive status badges
    const activeBadges = screen.getAllByText('有効');
    expect(activeBadges).toHaveLength(2);
    expect(screen.getByText('無効')).toBeInTheDocument();
  });

  it('shows empty message when no users', () => {
    render(<UserManagement users={[]} />);
    expect(screen.getByText('ユーザーがいません')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<UserManagement users={[]} isLoading={true} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('opens create user form when button is clicked', async () => {
    const user = userEvent.setup();
    render(<UserManagement users={mockUsers} />);

    await user.click(screen.getByText('ユーザー追加'));

    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('表示名')).toBeInTheDocument();
    expect(screen.getByLabelText('ロール')).toBeInTheDocument();
  });

  it('calls onCreateUser with form data on submit', async () => {
    const user = userEvent.setup();
    const onCreateUser = vi.fn();
    render(<UserManagement users={mockUsers} onCreateUser={onCreateUser} />);

    await user.click(screen.getByText('ユーザー追加'));
    await user.type(screen.getByLabelText('メールアドレス'), 'new@example.com');
    await user.type(screen.getByLabelText('表示名'), '新規ユーザー');
    await user.click(screen.getByText('登録'));

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

    const disableButtons = screen.getAllByText('無効化');
    await user.click(disableButtons[0]);

    expect(screen.getByText('ユーザー無効化の確認')).toBeInTheDocument();

    await user.click(screen.getByText('無効化する'));
    expect(onDisableUser).toHaveBeenCalledWith('user-1');
  });

  it('cancels disable confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<UserManagement users={mockUsers} />);

    const disableButtons = screen.getAllByText('無効化');
    await user.click(disableButtons[0]);

    expect(screen.getByText('ユーザー無効化の確認')).toBeInTheDocument();

    await user.click(screen.getByText('キャンセル'));
    expect(screen.queryByText('ユーザー無効化の確認')).not.toBeInTheDocument();
  });

  it('does not show disable button for already disabled users', () => {
    render(<UserManagement users={mockUsers} />);

    // Only 2 active users should have disable buttons
    const disableButtons = screen.getAllByText('無効化');
    expect(disableButtons).toHaveLength(2);
  });

  it('shows enable button only for disabled users', () => {
    render(<UserManagement users={mockUsers} />);

    // Only the single disabled user (user-3) should have an enable button
    const enableButtons = screen.getAllByText('有効化');
    expect(enableButtons).toHaveLength(1);
  });

  it('shows enable confirmation dialog and calls onEnableUser', async () => {
    const user = userEvent.setup();
    const onEnableUser = vi.fn();
    render(<UserManagement users={mockUsers} onEnableUser={onEnableUser} />);

    await user.click(screen.getByText('有効化'));

    expect(screen.getByText('ユーザー有効化の確認')).toBeInTheDocument();

    await user.click(screen.getByText('有効化する'));
    expect(onEnableUser).toHaveBeenCalledWith('user-3');
  });

  it('cancels enable confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<UserManagement users={mockUsers} />);

    await user.click(screen.getByText('有効化'));

    expect(screen.getByText('ユーザー有効化の確認')).toBeInTheDocument();

    await user.click(screen.getByText('キャンセル'));
    expect(screen.queryByText('ユーザー有効化の確認')).not.toBeInTheDocument();
  });

  it('displays role badges with correct labels', () => {
    render(<UserManagement users={mockUsers} />);

    expect(screen.getByText('管理者')).toBeInTheDocument();
    // Two REVIEWER users should have 'レビュアー' badges
    const reviewerBadges = screen.getAllByText('レビュアー');
    expect(reviewerBadges.length).toBe(2);
  });

  it('shows edit button only when onEditUser is provided', () => {
    const { rerender } = render(<UserManagement users={mockUsers} />);
    expect(screen.queryByLabelText('管理者太郎を編集')).not.toBeInTheDocument();

    rerender(<UserManagement users={mockUsers} onEditUser={vi.fn().mockResolvedValue(null)} />);
    expect(screen.getByLabelText('管理者太郎を編集')).toBeInTheDocument();
  });

  it('submits only changed fields when editing a user', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText('管理者太郎を編集'));

    const nameInput = screen.getByLabelText('表示名');
    await user.clear(nameInput);
    await user.type(nameInput, '管理者次郎');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onEditUser).toHaveBeenCalledWith('user-1', { displayName: '管理者次郎' });
  });

  it('shows an error message when edit fails', async () => {
    const user = userEvent.setup();
    const onEditUser = vi
      .fn()
      .mockResolvedValue({ code: 'VALIDATION_ERROR', message: 'このメールアドレスは既に使用されています。' });
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText('管理者太郎を編集'));
    const emailInput = screen.getByLabelText('メールアドレス');
    await user.clear(emailInput);
    await user.type(emailInput, 'reviewer@example.com');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('このメールアドレスは既に使用されています。');
  });

  it('calls onEditUser with the new role when the role is changed', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText('レビュアー花子を編集'));

    const roleSelect = screen.getByLabelText('ロール');
    await user.selectOptions(roleSelect, 'TEAM_LEADER');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onEditUser).toHaveBeenCalledWith('user-2', { role: 'TEAM_LEADER' });
  });

  it('does not include role in the payload when the role is unchanged', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(<UserManagement users={mockUsers} onEditUser={onEditUser} />);

    await user.click(screen.getByLabelText('レビュアー花子を編集'));

    const nameInput = screen.getByLabelText('表示名');
    await user.clear(nameInput);
    await user.type(nameInput, 'レビュアー次郎');
    await user.click(screen.getByRole('button', { name: '保存' }));

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

    await user.click(screen.getByLabelText('管理者太郎を編集'));

    const roleSelect = screen.getByLabelText('ロール');
    expect(roleSelect).toBeDisabled();
  });

  it('shows an error and does not call onEditUser when a self-admin submits a demotion', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    render(
      <UserManagement users={mockUsers} onEditUser={onEditUser} currentUserId="user-1" />
    );

    await user.click(screen.getByLabelText('管理者太郎を編集'));

    // The select is disabled in the UI, so drive the guard via the form state by
    // enabling the control before changing it, mirroring a bypass attempt.
    const roleSelect = screen.getByLabelText('ロール') as HTMLSelectElement;
    roleSelect.removeAttribute('disabled');
    await user.selectOptions(roleSelect, 'REVIEWER');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '自分自身の管理者ロールは変更できません。'
    );
    expect(onEditUser).not.toHaveBeenCalled();
  });

  it('has no accessibility violations when the edit form is open', async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <UserManagement users={mockUsers} onEditUser={onEditUser} />
    );

    await user.click(screen.getByLabelText('レビュアー花子を編集'));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
