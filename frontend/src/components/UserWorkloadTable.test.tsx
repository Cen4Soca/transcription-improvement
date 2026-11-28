import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { UserWorkloadTable } from './UserWorkloadTable';
import type { UserWorkloadItem } from '../types/monitoring';

const items: UserWorkloadItem[] = [
  {
    userId: 'u1', displayName: '山田太郎', email: 'y@x', role: 'REVIEWER', isActive: true,
    assignedCount: 5, inProgressCount: 3, stalledCount: 2,
  },
  {
    userId: 'u2', displayName: '佐藤花子', email: 's@x', role: 'TEAM_LEADER', isActive: true,
    assignedCount: 0, inProgressCount: 0, stalledCount: 0,
  },
];

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    listUserWorkload: vi.fn().mockResolvedValue({ ok: true, value: { data: { items } } }),
    listUserSessions: vi.fn().mockResolvedValue({ ok: true, value: { data: { items: [] } } }),
    ...overrides,
  };
}

describe('UserWorkloadTable', () => {
  it('renders assigned / in-progress / stalled counts per user', async () => {
    render(<UserWorkloadTable api={makeApi()} />);
    const row = (await screen.findByText('山田太郎')).closest('tr')!;
    expect(row).toHaveTextContent('5');
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('2');
  });

  it('expands a row to load that user’s sessions', async () => {
    const api = makeApi();
    render(<UserWorkloadTable api={api} />);
    await screen.findByText('山田太郎');

    const toggle = screen.getByRole('button', { name: '山田太郎 の担当セッションを表示' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);

    expect(await screen.findByText('担当セッションがありません。')).toBeInTheDocument();
    expect(api.listUserSessions).toHaveBeenCalledWith('u1');
    expect(screen.getByRole('button', { name: '山田太郎 の担当セッションを閉じる' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('shows an empty state', async () => {
    const api = makeApi({
      listUserWorkload: vi.fn().mockResolvedValue({ ok: true, value: { data: { items: [] } } }),
    });
    render(<UserWorkloadTable api={api} />);
    expect(await screen.findByText('対象のユーザーがいません。')).toBeInTheDocument();
  });

  it('shows the translated error', async () => {
    const api = makeApi({
      listUserWorkload: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'raw', errorCode: 'INSUFFICIENT_ROLE' },
      }),
    });
    render(<UserWorkloadTable api={api} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<UserWorkloadTable api={makeApi()} />);
    await screen.findByText('山田太郎');
    expect(await axe(container)).toHaveNoViolations();
  });
});
