import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { UserSessionsPanel } from './UserSessionsPanel';
import type { UserSessionItem } from '../types/monitoring';

const items: UserSessionItem[] = [
  {
    sessionId: 's1', name: '会議A', status: 'IN_PROGRESS', assignedTeamName: 'チーム1',
    isStalled: true, lastActivityAt: '2026-11-01T00:00:00.000Z',
    correctedSegments: 2, totalSegments: 8, progressPercent: 25,
  },
  {
    sessionId: 's2', name: '会議B', status: 'COMPLETED',
    isStalled: false, lastActivityAt: null,
    correctedSegments: 8, totalSegments: 8, progressPercent: 100,
  },
];

describe('UserSessionsPanel', () => {
  it('lists the sessions with progress and a stalled badge', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: { data: { items } } });
    render(<UserSessionsPanel userId="u1" loadUserSessions={load} />);

    expect(await screen.findByText('会議A')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('u1');
    expect(screen.getByText('滞留')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar').map((b) => b.getAttribute('aria-valuenow'))).toEqual([
      '25',
      '100',
    ]);
  });

  it('shows an empty message when the user has no sessions', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: { data: { items: [] } } });
    render(<UserSessionsPanel userId="u1" loadUserSessions={load} />);
    expect(await screen.findByText('担当セッションがありません。')).toBeInTheDocument();
  });

  it('shows the translated error', async () => {
    const load = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'raw', errorCode: 'USER_SESSIONS_FETCH_FAILED' },
    });
    render(<UserSessionsPanel userId="u1" loadUserSessions={load} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('ユーザーの担当セッションの取得に失敗しました。');
  });

  it('has no accessibility violations', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: { data: { items } } });
    const { container } = render(<UserSessionsPanel userId="u1" loadUserSessions={load} />);
    await screen.findByText('会議A');
    expect(await axe(container)).toHaveNoViolations();
  });
});
