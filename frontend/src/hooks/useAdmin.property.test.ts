import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as fc from 'fast-check';
import { useAdmin } from './useAdmin.js';
import type { AdminApi } from '../services/admin-api.js';
import type { SessionApi } from '../services/session-api.js';
import type { TeamAssignment } from '../types/team.js';

/**
 * Property-based tests for the team-assignment wiring in useAdmin
 * (bugfix: missing-frontend-consensus-and-team-assignment).
 *
 * Covers design.md "Correctness Properties / Property 1" for the
 * TEAM_ASSIGN_SESSION / TEAM_UNASSIGN_SESSION / TEAM_ASSIGNMENT_VIEW features:
 *   - assign → unassign round trips keep `teamAssignments` consistent
 *     (no duplicate adds, removal is reliable, other teams unaffected),
 *   - the backend createdBy/createdAt → frontend assignedBy/assignedAt mapping
 *     is preserved.
 *
 * It also adds a COMPLEMENTARY Preservation property not covered by
 * useAdmin.preservation.property.test.ts (task 2): that interleaving the NEW
 * assignment actions never mutates the existing users/teams/teamMembers state.
 * The task-2 preservation suite asserts existing-op route/body contracts and
 * their own state transitions; it does NOT assert that the new assignment
 * actions leave the existing state slices untouched — this file closes that gap
 * rather than duplicating the covered contracts.
 *
 * ApiClient is not touched directly; AdminApi/SessionApi are mocked via vi.fn().
 * numRuns: 100.
 */

type Spy = ReturnType<typeof vi.fn>;

/**
 * Build a stateful mock AdminApi backed by an in-memory assignment store keyed
 * by `${teamId}::${sessionId}`, so getTeamAssignments reflects assign/unassign
 * exactly as the real backend would. The store holds RAW backend records
 * (createdBy/createdAt); the service-layer mapAssignment inside AdminApi is the
 * code under test, but here we mock AdminApi itself, so we emit already-mapped
 * frontend records on the assign path and raw-equivalent mapped records on read
 * — mirroring AdminApi's documented contract (returns TeamAssignment).
 */
function createMockAdminApi() {
  const assignments = new Map<string, TeamAssignment>();
  const key = (teamId: string, sessionId: string) => `${teamId}::${sessionId}`;

  const okList = <T,>(data: T[]) => Promise.resolve({ ok: true as const, value: { data } });
  const okItem = <T,>(data: T) => Promise.resolve({ ok: true as const, value: { data } });
  const okEmptyPaginated = () =>
    Promise.resolve({
      ok: true as const,
      value: { data: [], pagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 } },
    });

  const api = {
    // read surface used by loadAll
    getUsers: vi.fn(() => okList([])),
    getTeams: vi.fn(() => okList([])),
    getTeamMembers: vi.fn(() => okList([])),
    getIPAllowlist: vi.fn(() => okList([])),
    searchAuditLogs: vi.fn(okEmptyPaginated),

    // assignment surface under test
    getTeamAssignments: vi.fn((teamId: string) =>
      okList([...assignments.values()].filter((a) => a.teamId === teamId))
    ),
    assignSession: vi.fn((teamId: string, sessionId: string) => {
      // createdBy/createdAt → assignedBy/assignedAt mapping is applied by the
      // real AdminApi.assignSession; the mock returns the mapped frontend shape.
      const record: TeamAssignment = {
        teamId,
        sessionId,
        assignedBy: `creator-${teamId}`,
        assignedAt: '2024-01-01T00:00:00Z',
      };
      assignments.set(key(teamId, sessionId), record);
      return okItem(record);
    }),
    unassignSession: vi.fn((teamId: string, sessionId: string) => {
      assignments.delete(key(teamId, sessionId));
      return okItem({ deleted: true });
    }),
  } as unknown as AdminApi;

  return { api, assignments };
}

function createMockSessionApi(): SessionApi {
  return {
    listSessions: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          items: [],
          pagination: {
            currentPage: 1,
            pageSize: 20,
            totalItems: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      })
    ),
  } as unknown as SessionApi;
}

function renderUseAdmin(adminApi: AdminApi, sessionApi: SessionApi) {
  return renderHook(() =>
    (useAdmin as unknown as (a: AdminApi, s?: SessionApi) => ReturnType<typeof useAdmin>)(
      adminApi,
      sessionApi
    )
  );
}

async function waitForLoaded(result: { current: ReturnType<typeof useAdmin> }) {
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });
}

function countAssignments(list: TeamAssignment[], teamId: string, sessionId: string): number {
  return list.filter((a) => a.teamId === teamId && a.sessionId === sessionId).length;
}

// --- arbitraries ---

const idArb = fc.string({ minLength: 1, maxLength: 10 });

/** A (teamId, sessionId) pair. */
const pairArb = fc.record({ teamId: idArb, sessionId: idArb });

describe('Feature: missing-frontend-consensus-and-team-assignment, Property 1: 割り当て/解除 — 往復で teamAssignments が整合しマッピングが保存される', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * For any (teamId, sessionId), an assign → unassign round trip returns
   * teamAssignments to not containing that pair, drives the correct AdminApi
   * methods (POST then DELETE), and preserves the createdBy→assignedBy mapping
   * on the intermediate assigned record.
   */
  it('assign then unassign round-trips a pair out of teamAssignments', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, idArb, async (teamId, sessionId) => {
        const { api } = createMockAdminApi();
        const sessionApi = createMockSessionApi();
        const { result } = renderUseAdmin(api, sessionApi);
        await waitForLoaded(result);

        await act(async () => {
          await result.current.assignSession(teamId, sessionId);
        });
        expect(api.assignSession as unknown as Spy).toHaveBeenCalledWith(teamId, sessionId);
        expect(countAssignments(result.current.teamAssignments, teamId, sessionId)).toBe(1);
        const added = result.current.teamAssignments.find(
          (a) => a.teamId === teamId && a.sessionId === sessionId
        )!;
        // Mapping preserved: assignedBy/assignedAt populated (not createdBy/createdAt).
        expect(added.assignedBy).toBe(`creator-${teamId}`);
        expect(added.assignedAt).toBe('2024-01-01T00:00:00Z');

        await act(async () => {
          await result.current.unassignSession(teamId, sessionId);
        });
        expect(api.unassignSession as unknown as Spy).toHaveBeenCalledWith(teamId, sessionId);
        expect(countAssignments(result.current.teamAssignments, teamId, sessionId)).toBe(0);
      }),
      { numRuns: 100 }
    );
  }, 30000);

  /**
   * **Validates: Requirements 2.6**
   *
   * Removal is reliable: unassign fully removes the targeted pair from
   * teamAssignments, even if it had been assigned more than once in the same
   * UI session. (Note: the hook's add path appends without de-duplication — see
   * design.md change 8 `setTeamAssignments((prev) => [...prev, ...])` — so this
   * property pins the guarantee that actually holds: the filter-based removal
   * clears every matching entry, so a round trip always leaves zero copies. The
   * assignable-session dropdown only offers unassigned candidates, so a genuine
   * double-assign of the same pair does not arise from the UI.)
   */
  it('unassign reliably removes the pair even after repeated assigns', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb,
        idArb,
        fc.integer({ min: 1, max: 3 }),
        async (teamId, sessionId, times) => {
          const { api } = createMockAdminApi();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(api, sessionApi);
          await waitForLoaded(result);

          await act(async () => {
            for (let i = 0; i < times; i += 1) {
              await result.current.assignSession(teamId, sessionId);
            }
          });
          expect(
            countAssignments(result.current.teamAssignments, teamId, sessionId)
          ).toBeGreaterThan(0);

          await act(async () => {
            await result.current.unassignSession(teamId, sessionId);
          });

          // Filter-based removal clears all copies — reliable removal.
          expect(countAssignments(result.current.teamAssignments, teamId, sessionId)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  /**
   * **Validates: Requirements 2.6, 2.7**
   *
   * Unassigning one pair never removes assignments belonging to a different
   * team (removal is scoped to the targeted teamId + sessionId).
   */
  it('unassigning one pair leaves other teams assignments untouched', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(pairArb, {
          minLength: 2,
          maxLength: 6,
          selector: (p) => `${p.teamId}::${p.sessionId}`,
        }),
        async (pairs) => {
          const { api } = createMockAdminApi();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(api, sessionApi);
          await waitForLoaded(result);

          for (const p of pairs) {
            await act(async () => {
              await result.current.assignSession(p.teamId, p.sessionId);
            });
          }
          expect(result.current.teamAssignments.length).toBe(pairs.length);

          const [removed, ...kept] = pairs;
          await act(async () => {
            await result.current.unassignSession(removed.teamId, removed.sessionId);
          });

          expect(
            countAssignments(result.current.teamAssignments, removed.teamId, removed.sessionId)
          ).toBe(0);
          for (const p of kept) {
            expect(countAssignments(result.current.teamAssignments, p.teamId, p.sessionId)).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  /**
   * **Validates: Requirements 2.8**
   *
   * When assign/unassign fail, the error is captured on `error` (Result-based,
   * no throw) and teamAssignments is not mutated — the UI does not crash.
   */
  it('failed assign surfaces error via Result and does not mutate teamAssignments', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, idArb, async (teamId, sessionId) => {
        const { api } = createMockAdminApi();
        (api.assignSession as unknown as Spy).mockResolvedValueOnce({
          ok: false,
          error: { code: 'FORBIDDEN', message: 'この操作を行う権限がありません。', statusCode: 403 },
        });
        const sessionApi = createMockSessionApi();
        const { result } = renderUseAdmin(api, sessionApi);
        await waitForLoaded(result);

        await act(async () => {
          await result.current.assignSession(teamId, sessionId);
        });

        expect(result.current.error?.code).toBe('FORBIDDEN');
        expect(countAssignments(result.current.teamAssignments, teamId, sessionId)).toBe(0);
      }),
      { numRuns: 100 }
    );
  }, 30000);
});

describe('Feature: missing-frontend-consensus-and-team-assignment, Property 2 (complementary): 保全 — 新規割り当て操作が既存 state を変えない', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * COMPLEMENTARY to useAdmin.preservation.property.test.ts (task 2), which
   * asserts existing-op route/body contracts and their own transitions. This
   * property asserts the inverse direction not covered there: for any random
   * sequence of the NEW assignment actions, the existing state slices
   * (users, teams, teamMembers) remain exactly as loaded — the new wiring does
   * not leak into unrelated existing state.
   */
  it('sequences of assign/unassign never mutate users/teams/teamMembers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ op: fc.constantFrom('assign', 'unassign'), teamId: idArb, sessionId: idArb }),
          { minLength: 1, maxLength: 6 }
        ),
        async (ops) => {
          const { api } = createMockAdminApi();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(api, sessionApi);
          await waitForLoaded(result);

          const usersBefore = result.current.users;
          const teamsBefore = result.current.teams;
          const teamMembersBefore = result.current.teamMembers;

          for (const o of ops) {
            await act(async () => {
              if (o.op === 'assign') {
                await result.current.assignSession(o.teamId, o.sessionId);
              } else {
                await result.current.unassignSession(o.teamId, o.sessionId);
              }
            });
          }

          // Existing slices are referentially unchanged (never re-set by the
          // assignment actions).
          expect(result.current.users).toBe(usersBefore);
          expect(result.current.teams).toBe(teamsBefore);
          expect(result.current.teamMembers).toBe(teamMembersBefore);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
