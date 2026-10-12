import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionListPageWrapper } from './App';

// --- Mock the API clients used by the wrapper ---

const listSessions = vi.fn();
const listAssignedSessions = vi.fn();
const claimSession = vi.fn();
const assignSession = vi.fn();
const getTeams = vi.fn();
const getTeamMembers = vi.fn();

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
      screen.getByRole('button', { name: '担当者を割り当て' })
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
      screen.getByRole('button', { name: '担当者を割り当て' })
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
      screen.queryByRole('button', { name: '担当者を割り当て' })
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
    expect(screen.queryByRole('button', { name: '担当者を割り当て' })).not.toBeInTheDocument();
  });
});
