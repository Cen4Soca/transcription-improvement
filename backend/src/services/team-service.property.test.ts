import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { ReviewAssignmentRecord } from '../repositories/team-repository.js';

/**
 * Property 1: Bug Condition exploration test for
 * `team-departure-revokes-uploaded-session-visibility`.
 *
 * Ownership-transfer model (案A'): a ReviewAssignment is "owner-retained" (and
 * MUST survive a full team departure) when `createdBy === userId` AND the
 * session has NO TeamAssignment. Any other assignment (team-granted, or
 * uploader-owned but already assigned to a team) is team-managed and is
 * revoked on departure.
 *
 * This test drives the private `revokeReviewAssignmentsIfOrphaned` through the
 * public `removeMemberFromTeam` and `deleteExistingTeam` entry points. The
 * repository and access-control modules are mocked (matching the existing
 * `team-service.test.ts` style). `hasAnyTeamAssignment` is additionally mocked
 * so we can control whether each session has a TeamAssignment; this is the
 * predicate the FIXED code relies on. On the UNFIXED code this function is not
 * consulted at all — the loop deletes every assignment unconditionally — so the
 * "owner-retained is kept" assertion below FAILS, which is the expected and
 * correct outcome for a bug-condition exploration test (it proves the bug).
 */

vi.mock('../repositories/team-repository.js', () => ({
  getTeamById: vi.fn(),
  getAllTeams: vi.fn(),
  getTeamsByUserId: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  deleteAllTeamAssignments: vi.fn(),
  deleteAllTeamMembers: vi.fn(),
  getTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  getTeamAssignments: vi.fn(),
  createTeamAssignment: vi.fn(),
  deleteTeamAssignment: vi.fn(),
  createReviewAssignment: vi.fn(),
  deleteReviewAssignment: vi.fn(),
  getReviewAssignmentsByUser: vi.fn(),
  // Added by the fix (task 3.1). Mocked here so the fixed code picks it up and
  // the exploration test encodes the expected (post-fix) behavior.
  hasAnyTeamAssignment: vi.fn(),
}));

vi.mock('./access-control-service.js', () => ({
  requireTeamAccess: vi.fn(),
  getUserTeamIds: vi.fn(),
  isTeamMember: vi.fn(),
}));

vi.mock('../repositories/user-repository.js', () => ({
  getUserById: vi.fn(),
}));

import { removeMemberFromTeam, deleteExistingTeam } from './team-service.js';
import * as teamRepo from '../repositories/team-repository.js';
import {
  getTeamById,
  getTeamMembers,
  deleteAllTeamAssignments,
  deleteAllTeamMembers,
  deleteTeam,
  removeTeamMember,
  deleteReviewAssignment,
  getReviewAssignmentsByUser,
} from '../repositories/team-repository.js';
import { requireTeamAccess, getUserTeamIds } from './access-control-service.js';

const mockedGetTeamById = vi.mocked(getTeamById);
const mockedGetTeamMembers = vi.mocked(getTeamMembers);
const mockedDeleteAllTeamAssignments = vi.mocked(deleteAllTeamAssignments);
const mockedDeleteAllTeamMembers = vi.mocked(deleteAllTeamMembers);
const mockedDeleteTeam = vi.mocked(deleteTeam);
const mockedRemoveTeamMember = vi.mocked(removeTeamMember);
const mockedDeleteReviewAssignment = vi.mocked(deleteReviewAssignment);
const mockedGetReviewAssignmentsByUser = vi.mocked(getReviewAssignmentsByUser);
const mockedRequireTeamAccess = vi.mocked(requireTeamAccess);
const mockedGetUserTeamIds = vi.mocked(getUserTeamIds);
// `hasAnyTeamAssignment` is not yet declared on the source module's type, but
// it exists on the mocked module object. Access it dynamically so this test
// compiles against the unfixed code (where the symbol is absent).
const mockedHasAnyTeamAssignment = (
  teamRepo as unknown as {
    hasAnyTeamAssignment: ReturnType<typeof vi.fn>;
  }
).hasAnyTeamAssignment;

const adminUser = {
  userId: 'admin-001',
  email: 'admin@test.com',
  displayName: 'Admin',
  role: 'ADMIN' as const,
};

/** The user whose assignments are evaluated during the orphan revoke. */
const TARGET_USER = 'target-user';
const OTHER_CREATOR = 'leader-xyz';

interface AssignmentSpec {
  sessionId: string;
  /** true => createdBy === TARGET_USER (uploader-owned), false => team-granted */
  ownedByUser: boolean;
  /** true => session has at least one TeamAssignment */
  hasTeamAssignment: boolean;
}

/** owner-retained := createdBy === userId AND no TeamAssignment on the session. */
function isOwnerRetained(spec: AssignmentSpec): boolean {
  return spec.ownedByUser && !spec.hasTeamAssignment;
}

function toRecord(spec: AssignmentSpec): ReviewAssignmentRecord {
  return {
    userId: TARGET_USER,
    sessionId: spec.sessionId,
    createdBy: spec.ownedByUser ? TARGET_USER : OTHER_CREATOR,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

/**
 * Arbitrary producing a set of assignments that satisfies `isBugCondition`:
 * the user is fully departed (teamIds empty) and at least one assignment is
 * owner-retained (createdBy === userId AND no TeamAssignment). The set mixes
 * owner-retained, team-granted, and transferred (owned but team-assigned)
 * assignments with unique sessionIds.
 */
const bugConditionAssignments = fc
  .uniqueArray(
    fc.record({
      sessionId: fc.string({ minLength: 1, maxLength: 12 }),
      ownedByUser: fc.boolean(),
      hasTeamAssignment: fc.boolean(),
    }),
    { minLength: 1, maxLength: 6, selector: (s) => s.sessionId }
  )
  .chain((specs) => {
    // Guarantee at least one owner-retained assignment (the bug-condition
    // witness). Give it a sessionId distinct from the generated ones.
    const retained: AssignmentSpec = {
      sessionId: `owned-${specs.map((s) => s.sessionId).join('_')}`,
      ownedByUser: true,
      hasTeamAssignment: false,
    };
    return fc.constant([retained, ...specs] as AssignmentSpec[]);
  });

function configureMocks(specs: AssignmentSpec[]): void {
  vi.clearAllMocks();
  mockedRequireTeamAccess.mockResolvedValue(undefined);
  mockedRemoveTeamMember.mockResolvedValue(undefined);
  mockedDeleteReviewAssignment.mockResolvedValue(undefined);
  // Full team departure => revoke fires.
  mockedGetUserTeamIds.mockResolvedValue([]);
  mockedGetReviewAssignmentsByUser.mockResolvedValue(specs.map(toRecord));

  const teamAssignmentBySession = new Map(
    specs.map((s) => [s.sessionId, s.hasTeamAssignment])
  );
  mockedHasAnyTeamAssignment.mockImplementation(async (sessionId: string) =>
    teamAssignmentBySession.get(sessionId) ?? false
  );
}

/** The set of sessionIds for which deleteReviewAssignment(TARGET_USER, x) was called. */
function deletedSessionIds(): Set<string> {
  const deleted = new Set<string>();
  for (const call of mockedDeleteReviewAssignment.mock.calls) {
    if (call[0] === TARGET_USER) {
      deleted.add(call[1] as string);
    }
  }
  return deleted;
}

describe('Feature: team-departure-revokes-uploaded-session-visibility, Property 1: Bug Condition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * Under the bug condition (full team departure + at least one owner-retained
   * assignment), revoke via `removeMemberFromTeam` MUST keep every
   * owner-retained ReviewAssignment (uploader-owned, not yet team-assigned) and
   * delete only the team-managed ones. The unfixed implementation deletes all
   * assignments, so the owner-retained session is lost from visibility; this
   * assertion therefore FAILS on unfixed code (proving the bug).
   */
  it('keeps owner-retained assignments and revokes only team-managed ones (removeMemberFromTeam)', async () => {
    await fc.assert(
      fc.asyncProperty(bugConditionAssignments, async (specs) => {
        configureMocks(specs);

        await removeMemberFromTeam(adminUser, 'team-A', TARGET_USER);

        const deleted = deletedSessionIds();

        // owner-retained (createdBy === userId AND no TeamAssignment) is kept.
        for (const spec of specs) {
          if (isOwnerRetained(spec)) {
            expect(deleted.has(spec.sessionId)).toBe(false);
          }
        }
        // Everything else (team-granted or transferred) is revoked.
        for (const spec of specs) {
          if (!isOwnerRetained(spec)) {
            expect(deleted.has(spec.sessionId)).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * The same collateral-deletion bug must also be absent along the
   * `deleteExistingTeam` cascade path (which reaches the shared
   * `revokeReviewAssignmentsIfOrphaned` via `revokeOrphanedReviewAssignments`).
   * Owner-retained assignments of a member who becomes fully orphaned by the
   * team deletion MUST be preserved. The unfixed code deletes them, so this
   * FAILS on unfixed code (proving the bug on the cascade path too).
   */
  it('keeps owner-retained assignments during team-deletion cascade (deleteExistingTeam)', async () => {
    await fc.assert(
      fc.asyncProperty(bugConditionAssignments, async (specs) => {
        configureMocks(specs);
        mockedGetTeamById.mockResolvedValue({
          teamId: 'team-A',
          name: 'Team A',
          createdBy: 'admin-001',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });
        mockedGetTeamMembers.mockResolvedValue([
          { teamId: 'team-A', userId: TARGET_USER, createdAt: '2024-01-01T00:00:00.000Z' },
        ]);
        mockedDeleteAllTeamAssignments.mockResolvedValue(undefined);
        mockedDeleteAllTeamMembers.mockResolvedValue(undefined);
        mockedDeleteTeam.mockResolvedValue(undefined);

        await deleteExistingTeam(adminUser, 'team-A');

        const deleted = deletedSessionIds();

        for (const spec of specs) {
          if (isOwnerRetained(spec)) {
            expect(deleted.has(spec.sessionId)).toBe(false);
          }
        }
        for (const spec of specs) {
          if (!isOwnerRetained(spec)) {
            expect(deleted.has(spec.sessionId)).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// Property 2: Preservation — behavior on non-bug inputs is identical
// pre/post fix, and Property 3: Ownership Transfer — team-assigned
// (transferred) sessions are revoked on departure.
//
// These run against the UNFIXED code and MUST PASS:
//   - Property 2(a): non-empty teamIds => early return, zero deletes
//     (unchanged by the fix).
//   - Property 2(b): empty teamIds + NO owner-retained assignment => every
//     assignment is deleted. The unfixed loop deletes all; the fixed loop also
//     deletes all because none satisfy isOwnerRetained (every one is either
//     team-granted or uploader-owned-but-team-assigned). Identical result.
//   - Property 3: empty teamIds + createdBy === userId but a TeamAssignment
//     exists (transferred) => that assignment is deleted. Unfixed deletes all;
//     fixed deletes it because it is NOT owner-retained. Identical result and
//     the correct ownership-transfer behavior.
// ============================================================

import { isAdmin } from '../utils/auth-middleware.js';

/**
 * Arbitrary producing Preservation case (a): the user still belongs to at
 * least one team. Any mix of assignments is allowed because the early return
 * fires before the loop is reached.
 */
const nonEmptyTeamIds = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 10 }),
  { minLength: 1, maxLength: 4 }
);

const anyAssignments = fc.uniqueArray(
  fc.record({
    sessionId: fc.string({ minLength: 1, maxLength: 12 }),
    ownedByUser: fc.boolean(),
    hasTeamAssignment: fc.boolean(),
  }),
  { minLength: 0, maxLength: 6, selector: (s) => s.sessionId }
) as fc.Arbitrary<AssignmentSpec[]>;

/**
 * Arbitrary producing Preservation case (b): full team departure
 * (teamIds empty) with NO owner-retained assignment. Each assignment is either
 * team-granted (ownedByUser === false) or uploader-owned-but-team-assigned
 * (ownedByUser === true AND hasTeamAssignment === true). We build it by taking
 * an arbitrary set and normalizing every owner-retained candidate into a
 * transferred one (hasTeamAssignment = true).
 */
const noOwnerRetainedAssignments = fc
  .uniqueArray(
    fc.record({
      sessionId: fc.string({ minLength: 1, maxLength: 12 }),
      ownedByUser: fc.boolean(),
      hasTeamAssignment: fc.boolean(),
    }),
    { minLength: 1, maxLength: 6, selector: (s) => s.sessionId }
  )
  .map((specs) =>
    specs.map((s) => ({
      sessionId: s.sessionId,
      ownedByUser: s.ownedByUser,
      // Force not-owner-retained: if uploader-owned, mark it as team-assigned.
      hasTeamAssignment: s.ownedByUser ? true : s.hasTeamAssignment,
    }))
  ) as fc.Arbitrary<AssignmentSpec[]>;

/**
 * Arbitrary producing a transferred assignment (createdBy === userId AND a
 * TeamAssignment exists) guaranteed to be present, mixed with an arbitrary
 * set, under full team departure. Used by Property 3.
 */
const transferredAssignments = fc
  .uniqueArray(
    fc.record({
      sessionId: fc.string({ minLength: 1, maxLength: 12 }),
      ownedByUser: fc.boolean(),
      hasTeamAssignment: fc.boolean(),
    }),
    { minLength: 0, maxLength: 5, selector: (s) => s.sessionId }
  )
  .chain((specs) => {
    const transferred: AssignmentSpec = {
      sessionId: `transferred-${specs.map((s) => s.sessionId).join('_')}`,
      ownedByUser: true,
      hasTeamAssignment: true,
    };
    return fc.constant([transferred, ...specs] as AssignmentSpec[]);
  });

describe('Feature: team-departure-revokes-uploaded-session-visibility, Property 2: Preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
   *
   * Preservation case (a): when the user still belongs to at least one team
   * (`getUserTeamIds` non-empty), `revokeReviewAssignmentsIfOrphaned` returns
   * early and deletes nothing. This early return is unchanged by the fix, so
   * the deleted set is empty on both unfixed and fixed code (3.2, also keeps
   * team-scope immediacy 3.3 intact since no revoke occurs).
   */
  it('deletes nothing when the user still belongs to a team (early return)', async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyTeamIds, anyAssignments, async (teamIds, specs) => {
        vi.clearAllMocks();
        mockedRequireTeamAccess.mockResolvedValue(undefined);
        mockedRemoveTeamMember.mockResolvedValue(undefined);
        mockedDeleteReviewAssignment.mockResolvedValue(undefined);
        mockedGetUserTeamIds.mockResolvedValue(teamIds);
        mockedGetReviewAssignmentsByUser.mockResolvedValue(specs.map(toRecord));
        const bySession = new Map(specs.map((s) => [s.sessionId, s.hasTeamAssignment]));
        mockedHasAnyTeamAssignment.mockImplementation(
          async (sessionId: string) => bySession.get(sessionId) ?? false
        );

        await removeMemberFromTeam(adminUser, 'team-A', TARGET_USER);

        expect(mockedDeleteReviewAssignment).not.toHaveBeenCalled();
        expect(deletedSessionIds().size).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.5**
   *
   * Preservation case (b): full team departure with NO owner-retained
   * assignment. Every assignment is team-granted (`createdBy !== userId`) or
   * uploader-owned-but-team-assigned. Both the unfixed and fixed code delete
   * the entire set, so the deleted set equals the full assignment set. This
   * keeps the Req 13.8 revoke of team-managed access (3.1) intact.
   */
  it('deletes every assignment when fully departed with no owner-retained assignment', async () => {
    await fc.assert(
      fc.asyncProperty(noOwnerRetainedAssignments, async (specs) => {
        configureMocks(specs);

        await removeMemberFromTeam(adminUser, 'team-A', TARGET_USER);

        const deleted = deletedSessionIds();
        const expected = new Set(specs.map((s) => s.sessionId));
        expect(deleted).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * The `deleteExistingTeam` cascade reaches the shared revoke via
   * `revokeOrphanedReviewAssignments`. For a fully-departed member with no
   * owner-retained assignment, the cascade must still revoke every
   * team-managed assignment (existing Req 13.8 intent preserved). The deleted
   * set equals the full assignment set on both unfixed and fixed code.
   */
  it('cascade (deleteExistingTeam) still revokes team-managed assignments', async () => {
    await fc.assert(
      fc.asyncProperty(noOwnerRetainedAssignments, async (specs) => {
        configureMocks(specs);
        mockedGetTeamById.mockResolvedValue({
          teamId: 'team-A',
          name: 'Team A',
          createdBy: 'admin-001',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });
        mockedGetTeamMembers.mockResolvedValue([
          { teamId: 'team-A', userId: TARGET_USER, createdAt: '2024-01-01T00:00:00.000Z' },
        ]);
        mockedDeleteAllTeamAssignments.mockResolvedValue(undefined);
        mockedDeleteAllTeamMembers.mockResolvedValue(undefined);
        mockedDeleteTeam.mockResolvedValue(undefined);

        await deleteExistingTeam(adminUser, 'team-A');

        const deleted = deletedSessionIds();
        const expected = new Set(specs.map((s) => s.sessionId));
        expect(deleted).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * ADMIN full-access invariance: an ADMIN user is classified as admin, which
   * is the precondition for `getAccessibleSessionIds` returning `null` (no
   * filter = all sessions). This classification is independent of the revoke
   * fix and holds pre/post fix.
   */
  it('keeps ADMIN classified as admin (full-access precondition)', () => {
    expect(isAdmin(adminUser)).toBe(true);
  });
});

describe('Feature: team-departure-revokes-uploaded-session-visibility, Property 3: Ownership Transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * A transferred assignment (`createdBy === userId` but the session has a
   * TeamAssignment) MUST be revoked on full team departure, because ownership
   * moved to the team when it was assigned. The unfixed code deletes it (it
   * deletes everything); the fixed code also deletes it because it is NOT
   * owner-retained. So this passes both pre- and post-fix.
   */
  it('revokes transferred assignments on departure (removeMemberFromTeam)', async () => {
    await fc.assert(
      fc.asyncProperty(transferredAssignments, async (specs) => {
        configureMocks(specs);

        await removeMemberFromTeam(adminUser, 'team-A', TARGET_USER);

        const deleted = deletedSessionIds();
        // Every transferred assignment (owned by user AND team-assigned) is deleted.
        for (const spec of specs) {
          if (spec.ownedByUser && spec.hasTeamAssignment) {
            expect(deleted.has(spec.sessionId)).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
