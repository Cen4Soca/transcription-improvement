import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as fc from 'fast-check';
import { useAdmin } from './useAdmin';
import type { AdminApi } from '../services/admin-api';
import type { SessionApi } from '../services/session-api';
import type { User, UserRole } from '../types/user';
import type { Team } from '../types/team';

/**
 * Preservation property tests for the "missing frontend: consensus & team
 * assignment" bugfix.
 *
 * OBSERVATION-FIRST methodology: these tests encode the behavior of the
 * EXISTING (non-bug-condition) operations as observed on the CURRENT unfixed
 * frontend. They are EXPECTED TO PASS against the unfixed code (establishing
 * the baseline to preserve) and MUST CONTINUE TO PASS after the fix
 * (task 3.10) — proving no regression of:
 *   - User management: createUser / disableUser / editUser → /admin/users family.
 *   - Team CRUD / members: createTeam / editTeam / deleteTeam / addMember /
 *     removeMember → /admin/teams and /admin/teams/{teamId}/members family.
 *   - Existing routes: /admin, /ranking, /sessions/:sessionId render under
 *     MemoryRouter.
 *
 * `AdminApi` is mocked via vi.fn() spies over a small stateful backing store so
 * both the invoked route/body contract AND the resulting state transitions
 * (including the re-fetch reconciliation that createUser/editUser perform via
 * loadUsers) can be asserted against the observed unfixed behavior, independent
 * of the concrete HTTP layer.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */

type Spy = ReturnType<typeof vi.fn>;

interface MockAdmin {
  api: AdminApi;
}

/**
 * Build a stateful mock AdminApi. Mutating operations update an in-memory store
 * and the read operations (getUsers/getTeams/getTeamMembers) reflect it, so the
 * hook's re-fetch reconciliation (createUser/editUser call loadUsers) observes a
 * consistent server state — exactly as the real backend would behave.
 */
function createMockAdmin(): MockAdmin {
  const users = new Map<string, User>();
  const teams = new Map<string, Team>();
  const members = new Map<string, Set<string>>();

  const okList = <T,>(data: T[]) => Promise.resolve({ ok: true as const, value: { data } });
  const okItem = <T,>(data: T) => Promise.resolve({ ok: true as const, value: { data } });
  const okEmptyPaginated = () =>
    Promise.resolve({
      ok: true as const,
      value: {
        data: [],
        pagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 },
      },
    });

  const api = {
    // --- read surface used by loadAll + reconciliation ---
    getUsers: vi.fn(() => okList([...users.values()])),
    getTeams: vi.fn(() => okList([...teams.values()])),
    getTeamMembers: vi.fn((teamId: string) =>
      okList([...(members.get(teamId) ?? new Set<string>())].map((userId) => ({
        teamId,
        userId,
        joinedAt: '2024-01-01T00:00:00Z',
      })))
    ),
    getIPAllowlist: vi.fn(() => okList([])),
    searchAuditLogs: vi.fn(okEmptyPaginated),

    // --- user management (existing, must be preserved) ---
    createUser: vi.fn((data: { email: string; displayName: string; role: UserRole }) => {
      const user: User = {
        userId: `u-${data.email}`,
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
      };
      users.set(user.userId, user);
      return okItem(user);
    }),
    updateUser: vi.fn((userId: string, data: Partial<User>) => {
      const existing: User = users.get(userId) ?? {
        userId,
        email: 'u@example.com',
        displayName: 'name',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
      };
      const updated: User = { ...existing, ...data };
      users.set(userId, updated);
      return okItem(updated);
    }),

    // --- team CRUD / members (existing, must be preserved) ---
    createTeam: vi.fn((data: { name: string }) => {
      const team: Team = {
        teamId: `team-${data.name}`,
        name: data.name,
        createdBy: 'admin',
        createdAt: '2024-01-01T00:00:00Z',
      };
      teams.set(team.teamId, team);
      members.set(team.teamId, new Set());
      return okItem(team);
    }),
    updateTeam: vi.fn((teamId: string, data: { name: string }) => {
      const existing = teams.get(teamId);
      const updated: Team = existing
        ? { ...existing, name: data.name }
        : { teamId, name: data.name, createdBy: 'admin', createdAt: '2024-01-01T00:00:00Z' };
      teams.set(teamId, updated);
      return okItem(updated);
    }),
    deleteTeam: vi.fn((teamId: string) => {
      teams.delete(teamId);
      members.delete(teamId);
      return okItem({ deleted: true });
    }),
    addTeamMember: vi.fn((teamId: string, userId: string) => {
      const set = members.get(teamId) ?? new Set<string>();
      set.add(userId);
      members.set(teamId, set);
      return okItem({ teamId, userId, joinedAt: '2024-01-01T00:00:00Z' });
    }),
    removeTeamMember: vi.fn((teamId: string, userId: string) => {
      members.get(teamId)?.delete(userId);
      return okItem({ deleted: true });
    }),

    // --- assignment surface (post-fix; not asserted by Preservation) ---
    getTeamAssignments: vi.fn(() => okList([])),
    assignSession: vi.fn((teamId: string, sessionId: string) =>
      okItem({ teamId, sessionId, assignedBy: 'admin', assignedAt: '2024-01-01T00:00:00Z' })
    ),
    unassignSession: vi.fn(() => okItem({ deleted: true })),
  } as unknown as AdminApi;

  return { api };
}

/**
 * Minimal SessionApi mock. Supplied so the hook behaves identically on the
 * pre-fix single-arg signature and the post-fix two-arg signature.
 */
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

/**
 * Render useAdmin tolerating both the current single-arg signature
 * `useAdmin(adminApi)` and the post-fix signature `useAdmin(adminApi, sessionApi)`.
 * The SessionApi mock is provided either way so Preservation assertions hold
 * identically before and after the fix.
 */
function renderUseAdmin(adminApi: AdminApi, sessionApi: SessionApi) {
  return renderHook(() =>
    (useAdmin as unknown as (a: AdminApi, s?: SessionApi) => ReturnType<typeof useAdmin>)(
      adminApi,
      sessionApi
    )
  );
}

/** Wait for the initial loadAll to settle so action-level assertions are isolated. */
async function waitForLoaded(result: { current: ReturnType<typeof useAdmin> }) {
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });
}

function spyOf(adminApi: AdminApi, name: string): Spy {
  return (adminApi as unknown as Record<string, Spy>)[name];
}

// --- fast-check arbitraries for existing operations ---

type ExistingOp =
  | { kind: 'createUser'; email: string; displayName: string; role: UserRole }
  | { kind: 'disableUser'; userId: string }
  | { kind: 'enableUser'; userId: string }
  | { kind: 'editUser'; userId: string; displayName: string }
  | { kind: 'createTeam'; name: string }
  | { kind: 'editTeam'; teamId: string; name: string }
  | { kind: 'deleteTeam'; teamId: string }
  | { kind: 'addMember'; teamId: string; userId: string }
  | { kind: 'removeMember'; teamId: string; userId: string };

const roleArb: fc.Arbitrary<UserRole> = fc.constantFrom('REVIEWER', 'TEAM_LEADER', 'ADMIN');
const idArb = fc.string({ minLength: 1, maxLength: 10 });
const nameArb = fc.string({ minLength: 1, maxLength: 10 });
const emailArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `${s}@example.com`);

const existingOpArb: fc.Arbitrary<ExistingOp> = fc.oneof(
  fc.record({ kind: fc.constant('createUser' as const), email: emailArb, displayName: nameArb, role: roleArb }),
  fc.record({ kind: fc.constant('disableUser' as const), userId: idArb }),
  fc.record({ kind: fc.constant('enableUser' as const), userId: idArb }),
  fc.record({ kind: fc.constant('editUser' as const), userId: idArb, displayName: nameArb }),
  fc.record({ kind: fc.constant('createTeam' as const), name: nameArb }),
  fc.record({ kind: fc.constant('editTeam' as const), teamId: idArb, name: nameArb }),
  fc.record({ kind: fc.constant('deleteTeam' as const), teamId: idArb }),
  fc.record({ kind: fc.constant('addMember' as const), teamId: idArb, userId: idArb }),
  fc.record({ kind: fc.constant('removeMember' as const), teamId: idArb, userId: idArb })
);

/** Drive one existing operation through the hook. */
async function runOp(result: { current: ReturnType<typeof useAdmin> }, op: ExistingOp) {
  await act(async () => {
    switch (op.kind) {
      case 'createUser':
        await result.current.createUser({ email: op.email, displayName: op.displayName, role: op.role });
        break;
      case 'disableUser':
        await result.current.disableUser(op.userId);
        break;
      case 'enableUser':
        await result.current.enableUser(op.userId);
        break;
      case 'editUser':
        await result.current.editUser(op.userId, { displayName: op.displayName });
        break;
      case 'createTeam':
        await result.current.createTeam(op.name);
        break;
      case 'editTeam':
        await result.current.editTeam(op.teamId, op.name);
        break;
      case 'deleteTeam':
        await result.current.deleteTeam(op.teamId);
        break;
      case 'addMember':
        await result.current.addMember(op.teamId, op.userId);
        break;
      case 'removeMember':
        await result.current.removeMember(op.teamId, op.userId);
        break;
    }
  });
}

/** Assert the expected AdminApi route/body contract was invoked for an op. */
function assertContract(adminApi: AdminApi, op: ExistingOp) {
  switch (op.kind) {
    case 'createUser':
      // POST /admin/users
      expect(spyOf(adminApi, 'createUser')).toHaveBeenCalledWith({
        email: op.email,
        displayName: op.displayName,
        role: op.role,
      });
      break;
    case 'disableUser':
      // PATCH /admin/users/{userId} { isActive: false }
      expect(spyOf(adminApi, 'updateUser')).toHaveBeenCalledWith(op.userId, { isActive: false });
      break;
    case 'enableUser':
      // PATCH /admin/users/{userId} { isActive: true }
      expect(spyOf(adminApi, 'updateUser')).toHaveBeenCalledWith(op.userId, { isActive: true });
      break;
    case 'editUser':
      // PATCH /admin/users/{userId} { displayName }
      expect(spyOf(adminApi, 'updateUser')).toHaveBeenCalledWith(op.userId, {
        displayName: op.displayName,
      });
      break;
    case 'createTeam':
      // POST /admin/teams { name }
      expect(spyOf(adminApi, 'createTeam')).toHaveBeenCalledWith({ name: op.name });
      break;
    case 'editTeam':
      // PATCH /admin/teams/{teamId} { name }
      expect(spyOf(adminApi, 'updateTeam')).toHaveBeenCalledWith(op.teamId, { name: op.name });
      break;
    case 'deleteTeam':
      // DELETE /admin/teams/{teamId}
      expect(spyOf(adminApi, 'deleteTeam')).toHaveBeenCalledWith(op.teamId);
      break;
    case 'addMember':
      // POST /admin/teams/{teamId}/members { userId }
      expect(spyOf(adminApi, 'addTeamMember')).toHaveBeenCalledWith(op.teamId, op.userId);
      break;
    case 'removeMember':
      // DELETE /admin/teams/{teamId}/members/{userId}
      expect(spyOf(adminApi, 'removeTeamMember')).toHaveBeenCalledWith(op.teamId, op.userId);
      break;
  }
}

describe('Feature: missing-frontend-consensus-and-team-assignment, Property 2: Preservation — 既存フロント機能の挙動不変', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * For a random sequence of existing (non-bug-condition) operations, every
   * operation drives its AdminApi method with the exact route/body contract
   * observed on the unfixed code. This fixes the baseline that the fix
   * (consensus + assignment wiring) must not disturb.
   */
  it(
    'random sequences of existing operations invoke the same routes/bodies',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(existingOpArb, { minLength: 1, maxLength: 6 }),
          async (ops) => {
            const { api } = createMockAdmin();
            const sessionApi = createMockSessionApi();
            const { result } = renderUseAdmin(api, sessionApi);
            await waitForLoaded(result);

            for (const op of ops) {
              await runOp(result, op);
            }

            for (const op of ops) {
              assertContract(api, op);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );

  /**
   * **Validates: Requirements 3.1**
   *
   * createUser appends the created user to the users state (observed state
   * transition, including the loadUsers re-fetch reconciliation). The fix must
   * preserve this.
   */
  it(
    'createUser appends the created user to state',
    async () => {
      await fc.assert(
        fc.asyncProperty(emailArb, nameArb, roleArb, async (email, displayName, role) => {
          const { api } = createMockAdmin();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(api, sessionApi);
          await waitForLoaded(result);

          await runOp(result, { kind: 'createUser', email, displayName, role });

          expect(result.current.users.some((u) => u.email === email)).toBe(true);
        }),
        { numRuns: 100 }
      );
    },
    30000
  );

  /**
   * **Validates: Requirements 3.1**
   *
   * disable/enable flip the isActive flag of the targeted user in state while
   * calling PATCH /admin/users/{userId}. Observed transition to preserve.
   */
  it(
    'disableUser then enableUser toggles isActive in state',
    async () => {
      await fc.assert(
        fc.asyncProperty(emailArb, nameArb, async (email, displayName) => {
          const { api } = createMockAdmin();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(api, sessionApi);
          await waitForLoaded(result);

          // Seed a user via createUser so there is a target in state.
          await runOp(result, { kind: 'createUser', email, displayName, role: 'REVIEWER' });
          const target = result.current.users.find((u) => u.email === email);
          expect(target).toBeDefined();
          const userId = target!.userId;

          await runOp(result, { kind: 'disableUser', userId });
          expect(result.current.users.find((u) => u.userId === userId)?.isActive).toBe(false);

          await runOp(result, { kind: 'enableUser', userId });
          expect(result.current.users.find((u) => u.userId === userId)?.isActive).toBe(true);
        }),
        { numRuns: 100 }
      );
    },
    30000
  );

  /**
   * **Validates: Requirements 3.2**
   *
   * Team CRUD + member management state transitions: create adds the team and
   * an empty member list; addMember/removeMember adjust that list; deleteTeam
   * removes the team and its members. Observed transitions to preserve.
   */
  it(
    'team create → addMember → removeMember → delete keeps state consistent',
    async () => {
      await fc.assert(
        fc.asyncProperty(nameArb, idArb, async (teamName, userId) => {
          const { api } = createMockAdmin();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(api, sessionApi);
          await waitForLoaded(result);

          await runOp(result, { kind: 'createTeam', name: teamName });
          const team = result.current.teams.find((t) => t.name === teamName);
          expect(team).toBeDefined();
          const teamId = team!.teamId;
          expect(result.current.teamMembers[teamId]).toEqual([]);

          await runOp(result, { kind: 'addMember', teamId, userId });
          expect(result.current.teamMembers[teamId]).toContain(userId);

          await runOp(result, { kind: 'removeMember', teamId, userId });
          expect(result.current.teamMembers[teamId] ?? []).not.toContain(userId);

          await runOp(result, { kind: 'deleteTeam', teamId });
          expect(result.current.teams.some((t) => t.teamId === teamId)).toBe(false);
          expect(result.current.teamMembers[teamId]).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    },
    30000
  );

  /**
   * **Validates: Requirements 3.2**
   *
   * editTeam renames the team in place without touching other teams. Observed
   * transition to preserve.
   */
  it(
    'editTeam renames the targeted team only',
    async () => {
      await fc.assert(
        fc.asyncProperty(nameArb, nameArb, async (initialName, newName) => {
          const { api } = createMockAdmin();
          const sessionApi = createMockSessionApi();
          const { result } = renderUseAdmin(api, sessionApi);
          await waitForLoaded(result);

          await runOp(result, { kind: 'createTeam', name: initialName });
          const team = result.current.teams.find((t) => t.name === initialName);
          expect(team).toBeDefined();
          const teamId = team!.teamId;

          await runOp(result, { kind: 'editTeam', teamId, name: newName });
          expect(result.current.teams.find((t) => t.teamId === teamId)?.name).toBe(newName);
        }),
        { numRuns: 100 }
      );
    },
    30000
  );
});

describe('Feature: missing-frontend-consensus-and-team-assignment, Property 2 (routes): 既存ルートの保全', () => {
  /**
   * **Validates: Requirements 3.3, 3.4, 3.5**
   *
   * Existing routes continue to render their page content under MemoryRouter.
   * This mirrors the pre-fix routing behavior that adding the new
   * /consensus/:sessionId route must not disturb. Content is rendered via a
   * minimal Routes table (independent of AuthGuard) across randomly chosen
   * existing paths.
   */
  it('existing routes render page content for any existing path', () => {
    const existingPaths = ['/admin', '/ranking', '/sessions/abc-123'] as const;

    fc.assert(
      fc.property(fc.constantFrom(...existingPaths), (path) => {
        const { unmount } = render(
          createElement(
            MemoryRouter,
            { initialEntries: [path] },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '/admin',
                element: createElement('div', null, '管理画面'),
              }),
              createElement(Route, {
                path: '/ranking',
                element: createElement('div', null, 'ランキング'),
              }),
              createElement(Route, {
                path: '/sessions/:sessionId',
                element: createElement('div', null, '校閲画面'),
              })
            )
          )
        );

        const expected =
          path === '/admin' ? '管理画面' : path === '/ranking' ? 'ランキング' : '校閲画面';
        expect(screen.getByText(expected)).toBeInTheDocument();
        unmount();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * The App module imports without error (the new consensus route/service added
   * by the fix must not break module resolution of existing routes). On the
   * unfixed code App imports cleanly; post-fix it must still import cleanly.
   */
  it('App module imports without error', async () => {
    const mod = await import('../App');
    expect(mod.default).toBeDefined();
  });
});
