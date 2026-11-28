import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SessionMonitoringPanel } from './SessionMonitoringPanel';
import type { MonitoringSessionItem, SessionProgress } from '../types/monitoring';
import type { Team } from '../types/team';

const teams: Team[] = [{ teamId: 't1', name: 'チーム1', createdBy: 'a', createdAt: '2026-01-01T00:00:00.000Z' }];

const sessions: MonitoringSessionItem[] = [
  {
    sessionId: 's1', name: '会議A', status: 'IN_PROGRESS',
    assignedTeamId: 't1', assignedTeamName: 'チーム1', assignedUserId: 'u1', assignedUserName: '山田太郎',
    participantCount: 2, isUnassigned: false, isStalled: true,
    lastActivityAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    sessionId: 's2', name: '会議B', status: 'PENDING',
    participantCount: 0, isUnassigned: true, isStalled: false,
    lastActivityAt: null, createdAt: '2026-10-02T00:00:00.000Z',
  },
];

const progress: SessionProgress = {
  sessionId: 's1', name: '会議A', status: 'IN_PROGRESS', totalSegments: 4, isStalled: true,
  lastActivityAt: null,
  reviewers: [
    { userId: 'u1', displayName: '山田太郎', correctedSegments: 2, totalSegments: 4, progressPercent: 50, lastActivityAt: null },
  ],
};

function pageOf(items: MonitoringSessionItem[], totalPages = 1, currentPage = 1) {
  return {
    ok: true as const,
    value: {
      data: {
        items,
        pagination: {
          currentPage, pageSize: 50, totalItems: items.length, totalPages,
          hasNextPage: currentPage < totalPages, hasPreviousPage: currentPage > 1,
        },
      },
    },
  };
}

function makeApi() {
  return {
    listSessions: vi.fn().mockResolvedValue(pageOf(sessions)),
    getSessionProgress: vi.fn().mockResolvedValue({ ok: true, value: { data: progress } }),
    listUserWorkload: vi.fn().mockResolvedValue({ ok: true, value: { data: { items: [] } } }),
    listUserSessions: vi.fn().mockResolvedValue({ ok: true, value: { data: { items: [] } } }),
  };
}

const loadTeamMembers = vi.fn().mockResolvedValue([
  { teamId: 't1', userId: 'u1', joinedAt: 'x', displayName: '山田太郎' },
]);

describe('SessionMonitoringPanel', () => {
  it('shows assignment, status, and unassigned / stalled badges', async () => {
    render(<SessionMonitoringPanel api={makeApi()} teams={teams} loadTeamMembers={loadTeamMembers} />);

    const rowA = (await screen.findByText('会議A')).closest('tr')!;
    expect(rowA).toHaveTextContent('進行中');
    expect(rowA).toHaveTextContent('チーム1');
    expect(rowA).toHaveTextContent('山田太郎');
    expect(rowA).toHaveTextContent('滞留');

    const rowB = screen.getByText('会議B').closest('tr')!;
    expect(rowB).toHaveTextContent('未割当');
    expect(rowB).not.toHaveTextContent('滞留');
  });

  it('sends the selected filters to the API and resets to page 1', async () => {
    const api = makeApi();
    render(<SessionMonitoringPanel api={api} teams={teams} loadTeamMembers={loadTeamMembers} />);
    await screen.findByText('会議A');

    await userEvent.selectOptions(screen.getByLabelText('ステータス'), 'IN_PROGRESS');
    await userEvent.click(screen.getByLabelText('滞留のみ'));
    await userEvent.click(screen.getByLabelText('未割当のみ'));
    await userEvent.selectOptions(screen.getByLabelText('チーム'), 't1');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Reviewer' }), 'u1');

    await waitFor(() =>
      expect(api.listSessions).toHaveBeenLastCalledWith({
        status: 'IN_PROGRESS', stalledOnly: true, unassignedOnly: true, teamId: 't1', userId: 'u1', page: 1,
      })
    );
  });

  it('expands a row to show per-reviewer progress', async () => {
    const api = makeApi();
    render(<SessionMonitoringPanel api={api} teams={teams} />);
    await screen.findByText('会議A');

    await userEvent.click(screen.getByRole('button', { name: '会議A の Reviewer 別進捗を表示' }));

    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(api.getSessionProgress).toHaveBeenCalledWith('s1');
    // Lists do not compute progress percentages: only the expanded row has a bar.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('opens the review screen for a session', async () => {
    const onOpenSession = vi.fn();
    render(<SessionMonitoringPanel api={makeApi()} teams={teams} onOpenSession={onOpenSession} />);
    await screen.findByText('会議A');
    await userEvent.click(screen.getByRole('button', { name: '会議A の校閲画面を開く' }));
    expect(onOpenSession).toHaveBeenCalledWith('s1');
  });

  it('pages through results', async () => {
    const api = makeApi();
    api.listSessions.mockResolvedValue(pageOf(sessions, 3, 1));
    render(<SessionMonitoringPanel api={api} teams={teams} />);
    await screen.findByText('会議A');

    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() => expect(api.listSessions).toHaveBeenLastCalledWith({ page: 2 }));
  });

  it('shows an empty state', async () => {
    const api = makeApi();
    api.listSessions.mockResolvedValue(pageOf([]));
    render(<SessionMonitoringPanel api={api} teams={teams} />);
    expect(await screen.findByText('条件に一致するセッションがありません。')).toBeInTheDocument();
  });

  it('shows the translated error', async () => {
    const api = makeApi();
    api.listSessions.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'raw', errorCode: 'MONITORING_SESSIONS_FETCH_FAILED' },
    });
    render(<SessionMonitoringPanel api={api} teams={teams} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('セッションの割当状況の取得に失敗しました。');
  });

  it('switches to the per-user view', async () => {
    const api = makeApi();
    render(<SessionMonitoringPanel api={api} teams={teams} />);
    await screen.findByText('会議A');
    await userEvent.click(screen.getByRole('tab', { name: 'ユーザー別' }));
    await waitFor(() => expect(api.listUserWorkload).toHaveBeenCalled());
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <SessionMonitoringPanel api={makeApi()} teams={teams} loadTeamMembers={loadTeamMembers} />
    );
    await screen.findByText('会議A');
    expect(await axe(container)).toHaveNoViolations();
  });
});
