import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as fc from 'fast-check';
import { useAdmin } from './useAdmin';
import type { AdminApi } from '../services/admin-api';
import type { SessionApi } from '../services/session-api';

/**
 * Bug condition exploration tests for the "missing frontend: consensus & team
 * assignment" bugfix.
 *
 * These tests encode the EXPECTED (post-fix) behavior described in
 * design.md "Correctness Properties / Property 1" and bugfix.md requirements
 * 2.1, 2.2, 2.5, 2.6, 2.7. They are EXPECTED TO FAIL against the current
 * (unfixed) frontend because:
 *   - `useAdmin.assignSession` / `unassignSession` are empty `// TODO` stubs.
 *   - `AdminApi` has no `assignSession` / `unassignSession` / `getTeamAssignments`.
 *   - `useAdmin`'s `sessions` / `teamAssignments` are hard-wired to empty arrays.
 *   - `frontend/src/services/consensus-api.ts` and the `/consensus/:sessionId`
 *     route do not exist.
 *
 * The SAME tests are re-run in task 3.9 to validate the fix.
 */

/**
 * Build a mock AdminApi whose assignment surface is spied. The current
 * implementation never calls these spies (bug), so call-count assertions
 * surface the counterexample.
 */
function createMockAdminApi(
  overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}
): AdminApi {
  const okEmpty = () => Promise.resolve({ ok: true as const, value: { data: [] } });
  const okEmptyPaginated = () =>
    Promise.resolve({
      ok: true as const,
      value: { data: [], pagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 } },
    });

  return {
    // existing surface used by loadAll
    getUsers: vi.fn(okEmpty),
    getTeams: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          data: [{ teamId: 't1', name: 'Team 1', createdBy: 'admin', createdAt: '2024-01-01T00:00:00Z' }],
        },
      })
    ),
    getTeamMembers: vi.fn(okEmpty),
    getIPAllowlist: vi.fn(okEmpty),
    searchAuditLogs: vi.fn(okEmptyPaginated),

    // assignment surface (expected to exist post-fix)
    getTeamAssignments: vi.fn(okEmpty),
    assignSession: vi.fn((teamId: string, sessionId: string) =>
      Promise.resolve({
        ok: true as const,
        value: { data: { teamId, sessionId, assignedBy: 'admin', assignedAt: '2024-01-01T00:00:00Z' } },
      })
    ),
    unassignSession: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { data: { deleted: true } } })
    ),
    ...overrides,
  } as unknown as AdminApi;
}

/**
 * Build a mock SessionApi returning assignable session candidates. Post-fix,
 * useAdmin should surface these as `sessions`.
 */
function createMockSessionApi(): SessionApi {
  return {
    listSessions: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        items: [
          {
            sessionId: 's1',
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
  } as unknown as SessionApi;
}

/**
 * Render useAdmin tolerating both the current single-arg signature
 * `useAdmin(adminApi)` and the post-fix signature `useAdmin(adminApi, sessionApi)`.
 * The design keeps the possibility of wiring SessionApi inside the hook, so the
 * test provides the SessionApi mock either way.
 */
function renderUseAdmin(adminApi: AdminApi, sessionApi: SessionApi) {
  return renderHook(() => (useAdmin as unknown as (a: AdminApi, s?: SessionApi) => ReturnType<typeof useAdmin>)(adminApi, sessionApi));
}

describe('Feature: missing-frontend-consensus-and-team-assignment, Property 1: Bug Condition — 欠落フロント機能がバックエンドを駆動しない', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * Expected behavior (post-fix): calling useAdmin.assignSession(teamId, sessionId)
   * drives `AdminApi.assignSession` (POST /admin/teams/{teamId}/assignments).
   * Unfixed: assignSession is an empty stub, so the spy is never called.
   */
  it('assignSession(teamId, sessionId) drives AdminApi.assignSession for any ids', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (teamId, sessionId) => {
          const adminApi = createMockAdminApi();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(adminApi, sessionApi);

          await act(async () => {
            await result.current.assignSession(teamId, sessionId);
          });

          const spy = (adminApi as unknown as { assignSession: ReturnType<typeof vi.fn> }).assignSession;
          expect(spy).toHaveBeenCalledWith(teamId, sessionId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * Expected behavior (post-fix): useAdmin.unassignSession drives
   * `AdminApi.unassignSession` (DELETE /admin/teams/{teamId}/assignments/{sessionId}).
   * Unfixed: unassignSession is an empty stub, so the spy is never called.
   */
  it('unassignSession(teamId, sessionId) drives AdminApi.unassignSession (DELETE) for any ids', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (teamId, sessionId) => {
          const adminApi = createMockAdminApi();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(adminApi, sessionApi);

          await act(async () => {
            await result.current.unassignSession(teamId, sessionId);
          });

          const spy = (adminApi as unknown as { unassignSession: ReturnType<typeof vi.fn> }).unassignSession;
          expect(spy).toHaveBeenCalledWith(teamId, sessionId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * Expected behavior (post-fix): the initial load populates `sessions`
   * (assignable candidates via GET /sessions) so TeamManagement is NOT stuck
   * showing "割り当て可能なセッションがありません". Unfixed: `sessions` is a
   * useState([]) with no setter and loadAll never fetches candidates.
   */
  it('initial load populates assignable session candidates (sessions is non-empty)', async () => {
    const adminApi = createMockAdminApi();
    const sessionApi = createMockSessionApi();
    const { result } = renderUseAdmin(adminApi, sessionApi);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sessions.length).toBeGreaterThan(0);
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * Expected behavior (post-fix): the initial load fetches current team
   * assignments and maps backend `createdBy`/`createdAt` to frontend
   * `assignedBy`/`assignedAt`. Unfixed: `teamAssignments` is empty-fixed and
   * `AdminApi.getTeamAssignments` is never called.
   */
  it('initial load fetches current team assignments and surfaces them', async () => {
    const adminApi = createMockAdminApi({
      getTeamAssignments: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { data: [{ teamId: 't1', sessionId: 's1', assignedBy: 'admin', assignedAt: '2024-01-01T00:00:00Z' }] },
        })
      ),
    });
    const sessionApi = createMockSessionApi();
    const { result } = renderUseAdmin(adminApi, sessionApi);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const spy = (adminApi as unknown as { getTeamAssignments: ReturnType<typeof vi.fn> }).getTeamAssignments;
    expect(spy).toHaveBeenCalledWith('t1');
    expect(result.current.teamAssignments.length).toBeGreaterThan(0);
    // createdBy/createdAt → assignedBy/assignedAt mapping must be preserved.
    expect(result.current.teamAssignments[0]).toMatchObject({
      teamId: 't1',
      sessionId: 's1',
      assignedBy: expect.any(String),
      assignedAt: expect.any(String),
    });
  });
});

describe('Feature: missing-frontend-consensus-and-team-assignment, Property 1 (edge): Consensus フロント不在', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * Expected behavior (post-fix): `consensus-api.ts` exists and exposes a
   * `ConsensusApi` class with `getConsensusSegments` / `resolveConsensus`.
   * Unfixed: the module does not exist, so the dynamic import rejects.
   */
  it('frontend/src/services/consensus-api.ts exists and exports ConsensusApi with the correct contract', async () => {
    // Use a runtime-computed specifier so a missing module surfaces as a
    // rejected dynamic import at test time (recordable counterexample) rather
    // than a static Vite resolve error that aborts the whole suite.
    const specifier = ['..', 'services', 'consensus-api'].join('/');
    const mod = await import(/* @vite-ignore */ specifier).catch(() => null);
    expect(mod).not.toBeNull();
    expect(mod).toHaveProperty('ConsensusApi');

    const ConsensusApi = (mod as { ConsensusApi: new (client: unknown) => unknown }).ConsensusApi;
    const client = {
      get: vi.fn(() => Promise.resolve({ ok: true as const, value: { data: [] } })),
      post: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: { data: { consensusText: 'x' } } })
      ),
    };
    const api = new ConsensusApi(client) as {
      getConsensusSegments: (sessionId: string) => Promise<unknown>;
      resolveConsensus: (
        sessionId: string,
        input: { segmentId: string; selectedText: string }
      ) => Promise<unknown>;
    };

    await api.getConsensusSegments('session-1');
    expect(client.get).toHaveBeenCalledWith('/consensus/session-1/segments');

    await api.resolveConsensus('session-1', { segmentId: 'seg-1', selectedText: 'ans' });
    expect(client.post).toHaveBeenCalledWith('/consensus/session-1/resolve', {
      segmentId: 'seg-1',
      selectedText: 'ans',
    });
  });
});
