import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionListPageWrapper } from './App';
import i18n from './i18n';

const assignUserName = () => i18n.t('review:assignment.assignUser');

// --- Mock the API clients used by the wrapper ---

const listSessions = vi.fn();
const listAssignedSessions = vi.fn();
const claimSession = vi.fn();
const assignSession = vi.fn();
const getTeams = vi.fn();
const getTeamMembers = vi.fn();
const listMonitoringSessions = vi.fn();

vi.mock('./services/api-client', () => ({
  ApiClient: class {
    constructor() {}
  },
}));

vi.mock('./services/session-api', () => ({
  SessionApi: class {
    listSessions = listSessions;
    listAssignedSessions = listAssignedSessions;
    claimSession = claimSession;
    assignSession = assignSession;
  },
}));

vi.mock('./services/monitoring-api', () => ({
  MonitoringApi: class {
    listSessions = listMonitoringSessions;
    getSessionProgress = vi.fn();
    listUserWorkload = vi.fn();
    listUserSessions = vi.fn();
  },
}));

vi.mock('./services/admin-api', () => ({
  AdminApi: class {
    getTeams = getTeams;
    getTeamMembers = getTeamMembers;
  },
}));

const sampleSessions = [
  {
    sessionId: 's1',
    transcriptionJobId: 'j1',
    name: 'セッションA',
    status: 'PENDING',
    assignedReviewerCount: 0,
    consensusThreshold: 67,
    partialAggregationEnabled: false,
    createdAt: '2024-06-15T10:30:00.000Z',
    updatedAt: '2024-06-15T10:30:00.000Z',
  },
];

const getToken = async () => 'token';

describe('SessionListPageWrapper - assignment actions rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSessions.mockResolvedValue({ ok: true, value: { items: sampleSessions } });
    listAssignedSessions.mockResolvedValue({ ok: true, value: { data: { items: sampleSessions } } });
    getTeams.mockResolvedValue({ ok: true, value: { data: [] } });
    getTeamMembers.mockResolvedValue({ ok: true, value: { data: [] } });
  });

  it('shows the assign button for an ADMIN on the session list', async () => {
    render(
      <MemoryRouter>
        <SessionListPageWrapper getToken={getToken} userRole="ADMIN" userId="admin-1" />
      </MemoryRouter>
    );

    expect(await screen.findByText('セッションA')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: assignUserName() })
    ).toBeInTheDocument();
  });

  it('shows the assign button for a TEAM_LEADER', async () => {
    render(
      <MemoryRouter>
        <SessionListPageWrapper getToken={getToken} userRole="TEAM_LEADER" userId="leader-1" />
      </MemoryRouter>
    );

    expect(await screen.findByText('セッションA')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: assignUserName() })
    ).toBeInTheDocument();
  });

  it('shows the claim button (not assign) for a REVIEWER', async () => {
    render(
      <MemoryRouter>
        <SessionListPageWrapper getToken={getToken} userRole="REVIEWER" userId="rev-1" />
      </MemoryRouter>
    );

    expect(await screen.findByText('セッションA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '引き受ける' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: assignUserName() })
    ).not.toBeInTheDocument();
  });

  it('renders no actions when userRole is undefined', async () => {
    render(
      <MemoryRouter>
        <SessionListPageWrapper getToken={getToken} userId="x" />
      </MemoryRouter>
    );

    expect(await screen.findByText('セッションA')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '引き受ける' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: assignUserName() })).not.toBeInTheDocument();
  });
});

describe('SessionListPageWrapper - monitoring view switch', () => {
  const switchName = () => i18n.t('monitoring:view.ariaLabel');

  beforeEach(() => {
    vi.clearAllMocks();
    listSessions.mockResolvedValue({ ok: true, value: { items: sampleSessions } });
    listAssignedSessions.mockResolvedValue({ ok: true, value: { data: { items: sampleSessions } } });
    getTeams.mockResolvedValue({ ok: true, value: { data: [] } });
    getTeamMembers.mockResolvedValue({ ok: true, value: { data: [] } });
    listMonitoringSessions.mockResolvedValue({
      ok: true,
      value: {
        data: {
          items: [
            {
              sessionId: 's1', name: '監視セッション', status: 'PENDING', participantCount: 0,
              isUnassigned: true, isStalled: false, lastActivityAt: null,
              createdAt: '2024-06-15T10:30:00.000Z',
            },
          ],
          pagination: {
            currentPage: 1, pageSize: 50, totalItems: 1, totalPages: 1,
            hasNextPage: false, hasPreviousPage: false,
          },
        },
      },
    });
  });

  it.each(['ADMIN', 'TEAM_LEADER'] as const)('lets %s switch to the assignment/progress view', async (role) => {
    render(
      <MemoryRouter>
        <SessionListPageWrapper getToken={getToken} userRole={role} userId="u" />
      </MemoryRouter>
    );

    expect(await screen.findByText('セッションA')).toBeInTheDocument();
    expect(listMonitoringSessions).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '割当・進捗' }));

    expect(await screen.findByText('監視セッション')).toBeInTheDocument();
    expect(listMonitoringSessions).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '割当・進捗' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'セッション一覧' }));
    expect(await screen.findByText('セッションA')).toBeInTheDocument();
  });

  it('hides the switch from a REVIEWER', async () => {
    render(
      <MemoryRouter>
        <SessionListPageWrapper getToken={getToken} userRole="REVIEWER" userId="rev-1" />
      </MemoryRouter>
    );
    expect(await screen.findByText('セッションA')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: switchName() })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '割当・進捗' })).not.toBeInTheDocument();
  });

  it('hides the switch for non-"all" scopes even for an ADMIN', async () => {
    render(
      <MemoryRouter>
        <SessionListPageWrapper getToken={getToken} userRole="ADMIN" userId="a" scope="assigned" />
      </MemoryRouter>
    );
    expect(await screen.findByText('セッションA')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: switchName() })).not.toBeInTheDocument();
  });
});
