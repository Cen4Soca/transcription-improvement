import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAdmin } from './useAdmin';
import type { AdminApi } from '../services/admin-api';
import type { SessionApi } from '../services/session-api';

/**
 * Example-based unit tests for useAdmin (bugfix:
 * missing-frontend-consensus-and-team-assignment).
 *
 * Complements the property tests (useAdmin.*.property.test.ts): here we verify
 * concrete success/failure cases for the newly-wired assignment surface and the
 * initial load, plus that an existing action (createTeam) is unchanged.
 *
 * Validates: Requirements 2.5, 2.6, 2.7, 2.8
 */

interface MockFns {
  getUsers: ReturnType<typeof vi.fn>;
  getTeams: ReturnType<typeof vi.fn>;
  getTeamMembers: ReturnType<typeof vi.fn>;
  getTeamAssignments: ReturnType<typeof vi.fn>;
  getIPAllowlist: ReturnType<typeof vi.fn>;
  searchAuditLogs: ReturnType<typeof vi.fn>;
  assignSession: ReturnType<typeof vi.fn>;
  unassignSession: ReturnType<typeof vi.fn>;
  createTeam: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
}

function okList<T>(data: T[]) {
  return Promise.resolve({ ok: true as const, value: { data } });
}

function createMocks(overrides: Partial<MockFns> = {}): {
  adminApi: AdminApi;
  sessionApi: SessionApi;
  fns: MockFns;
} {
  const fns: MockFns = {
    getUsers: overrides.getUsers ?? vi.fn(() => okList([])),
    getTeams:
      overrides.getTeams ??
      vi.fn(() =>
        okList([
          { teamId: 'team-1', name: 'Team 1', createdBy: 'admin', createdAt: '2024-01-01T00:00:00Z' },
        ])
      ),
    getTeamMembers: overrides.getTeamMembers ?? vi.fn(() => okList([])),
    getTeamAssignments:
      overrides.getTeamAssignments ??
      vi.fn(() =>
        okList([
          { teamId: 'team-1', sessionId: 'session-1', assignedBy: 'admin', assignedAt: '2024-01-01T00:00:00Z' },
        ])
      ),
    getIPAllowlist: overrides.getIPAllowlist ?? vi.fn(() => okList([])),
    searchAuditLogs:
      overrides.searchAuditLogs ??
      vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { data: [], pagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 } },
        })
      ),
    assignSession:
      overrides.assignSession ??
      vi.fn((teamId: string, sessionId: string) =>
        Promise.resolve({
          ok: true as const,
          value: { data: { teamId, sessionId, assignedBy: 'admin', assignedAt: '2024-01-01T00:00:00Z' } },
        })
      ),
    unassignSession:
      overrides.unassignSession ??
      vi.fn(() => Promise.resolve({ ok: true as const, value: { data: { deleted: true } } })),
    createTeam:
      overrides.createTeam ??
      vi.fn((data: { name: string }) =>
        Promise.resolve({
          ok: true as const,
          value: { data: { teamId: 'team-new', name: data.name, createdBy: 'admin', createdAt: '2024-01-03T00:00:00Z' } },
        })
      ),
    listSessions:
      overrides.listSessions ??
      vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          items: [
            {
              sessionId: 'session-1',
              transcriptionJobId: 'job-1',
              name: 'Session 1',
              status: 'PENDING',
              assignedReviewerCount: 3,
              consensusThreshold: 70,
              partialAggregationEnabled: false,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        })
      ),
  };

  const adminApi = {
    getUsers: fns.getUsers,
    getTeams: fns.getTeams,
    getTeamMembers: fns.getTeamMembers,
    getTeamAssignments: fns.getTeamAssignments,
    getIPAllowlist: fns.getIPAllowlist,
    searchAuditLogs: fns.searchAuditLogs,
    assignSession: fns.assignSession,
    unassignSession: fns.unassignSession,
    createTeam: fns.createTeam,
  } as unknown as AdminApi;

  const sessionApi = { listSessions: fns.listSessions } as unknown as SessionApi;

  return { adminApi, sessionApi, fns };
}

describe('useAdmin — team assignment wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initial load populates sessions and teamAssignments', async () => {
    const { adminApi, sessionApi, fns } = createMocks();
    const { result } = renderHook(() => useAdmin(adminApi, sessionApi));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fns.listSessions).toHaveBeenCalled();
    expect(fns.getTeamAssignments).toHaveBeenCalledWith('team-1');
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].sessionId).toBe('session-1');
    expect(result.current.teamAssignments).toHaveLength(1);
    expect(result.current.teamAssignments[0]).toMatchObject({
      teamId: 'team-1',
      sessionId: 'session-1',
      assignedBy: 'admin',
    });
  });

  it('assignSession success adds to teamAssignments', async () => {
    // Start with no current assignments so the add is observable.
    const { adminApi, sessionApi } = createMocks({
      getTeamAssignments: vi.fn(() => okList([])),
    });
    const { result } = renderHook(() => useAdmin(adminApi, sessionApi));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.teamAssignments).toHaveLength(0);

    await act(async () => {
      await result.current.assignSession('team-1', 'session-1');
    });

    expect(result.current.teamAssignments).toHaveLength(1);
    expect(result.current.teamAssignments[0]).toMatchObject({
      teamId: 'team-1',
      sessionId: 'session-1',
    });
    expect(result.current.error).toBeNull();
  });

  it('unassignSession success removes from teamAssignments', async () => {
    const { adminApi, sessionApi } = createMocks();
    const { result } = renderHook(() => useAdmin(adminApi, sessionApi));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.teamAssignments).toHaveLength(1);

    await act(async () => {
      await result.current.unassignSession('team-1', 'session-1');
    });

    expect(result.current.teamAssignments).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('assignSession failure sets error and does not add an assignment', async () => {
    const { adminApi, sessionApi } = createMocks({
      getTeamAssignments: vi.fn(() => okList([])),
      assignSession: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'FORBIDDEN', message: '自チーム以外は操作できません。', statusCode: 403 },
        })
      ),
    });
    const { result } = renderHook(() => useAdmin(adminApi, sessionApi));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.assignSession('team-9', 'session-1');
    });

    expect(result.current.teamAssignments).toHaveLength(0);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.code).toBe('FORBIDDEN');
  });

  it('unassignSession failure sets error and keeps the assignment', async () => {
    const { adminApi, sessionApi } = createMocks({
      unassignSession: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'NOT_FOUND', message: 'assignment not found', statusCode: 404 },
        })
      ),
    });
    const { result } = renderHook(() => useAdmin(adminApi, sessionApi));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.unassignSession('team-1', 'session-1');
    });

    expect(result.current.teamAssignments).toHaveLength(1);
    expect(result.current.error?.code).toBe('NOT_FOUND');
  });

  it('leaves an existing action (createTeam) unchanged', async () => {
    const { adminApi, sessionApi, fns } = createMocks();
    const { result } = renderHook(() => useAdmin(adminApi, sessionApi));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const teamsBefore = result.current.teams.length;

    await act(async () => {
      await result.current.createTeam('新チーム');
    });

    expect(fns.createTeam).toHaveBeenCalledWith({ name: '新チーム' });
    expect(result.current.teams).toHaveLength(teamsBefore + 1);
    expect(result.current.teams.some((t) => t.name === '新チーム')).toBe(true);
  });
});
