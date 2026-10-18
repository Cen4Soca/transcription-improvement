import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { AuthUser } from '../utils/auth-middleware.js';
import type { SessionRecord } from '../repositories/session-repository.js';

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
  getSessionsByTeamId: vi.fn(),
  getAllSessions: vi.fn(),
  getSessionIdsByParticipantUserId: vi.fn(),
  addParticipant: vi.fn(),
  // sortByCreatedAtDesc is a pure helper; use the real implementation.
  sortByCreatedAtDesc: (sessions: unknown[]) =>
    [...(sessions as { createdAt: string }[])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
}));

vi.mock('./access-control-service.js', () => ({
  getUserTeamIds: vi.fn(),
  isTeamMember: vi.fn(),
}));

import { selfAssignSession, listJoinableSessions } from './session-service.js';
import {
  getSessionById,
  getSessionsByTeamId,
  getAllSessions,
  getSessionIdsByParticipantUserId,
  addParticipant,
} from '../repositories/session-repository.js';
import { getUserTeamIds, isTeamMember } from './access-control-service.js';

const mockedGetSessionById = vi.mocked(getSessionById);
const mockedGetSessionsByTeamId = vi.mocked(getSessionsByTeamId);
const mockedGetAllSessions = vi.mocked(getAllSessions);
const mockedGetSessionIdsByParticipantUserId = vi.mocked(getSessionIdsByParticipantUserId);
const mockedAddParticipant = vi.mocked(addParticipant);
const mockedGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockedIsTeamMember = vi.mocked(isTeamMember);

const statusArb = fc.constantFrom<SessionRecord['status']>(
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED'
);

function makeSession(overrides: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
  return {
    name: 'Session',
    status: 'PENDING',
    assignedReviewerCount: 0,
    consensusThreshold: 67,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const sessionArb = fc
  .record({
    sessionId: fc.string({ minLength: 1, maxLength: 8 }),
    status: statusArb,
    assignedTeamId: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: undefined }),
    createdAt: fc
      .integer({ min: 0, max: 1_000_000 })
      .map((n) => new Date(1_700_000_000_000 + n * 1000).toISOString()),
  })
  .map((r) =>
    makeSession({
      sessionId: r.sessionId,
      status: r.status,
      assignedTeamId: r.assignedTeamId,
      createdAt: r.createdAt,
    })
  );

describe('Feature: self-assign, Property 1: selfAssignSession の冪等性', () => {
  /**
   * **Validates: FR-2**
   *
   * For any team-member reviewer and any session, calling selfAssignSession
   * twice registers the participant exactly once (addParticipant is called with
   * the same (sessionId, userId) each time but a brand-new participant is only
   * added on the first call), and the reviewer count is never double-counted:
   * the second call returns a session whose assignedReviewerCount equals the
   * first call's result.
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calling twice does not double-count the reviewer or duplicate the participant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 8 }), // sessionId
        fc.string({ minLength: 1, maxLength: 6 }), // teamId
        fc.integer({ min: 0, max: 50 }), // initial reviewer count
        async (sessionId, teamId, initialCount) => {
          const user: AuthUser = {
            userId: 'reviewer-1',
            email: 'r@example.com',
            displayName: 'R',
            role: 'REVIEWER',
          };

          // Stateful participant set modelling addParticipant's idempotency and
          // the atomic reviewer-count bump that only happens on a real insert.
          const participants = new Set<string>();
          let reviewerCount = initialCount;

          const base = makeSession({
            sessionId,
            status: 'PENDING',
            assignedTeamId: teamId,
            assignedReviewerCount: initialCount,
          });

          mockedIsTeamMember.mockResolvedValue(true);
          mockedAddParticipant.mockImplementation(async (sid: string, uid: string) => {
            expect(sid).toBe(sessionId);
            expect(uid).toBe(user.userId);
            if (participants.has(uid)) {
              return false; // already a participant — no-op
            }
            participants.add(uid);
            reviewerCount += 1;
            return true;
          });
          // getSessionById: first call returns the pre-join session; subsequent
          // calls (initial lookup + optional refresh) reflect the current count.
          mockedGetSessionById.mockImplementation(async () =>
            makeSession({
              sessionId,
              status: 'PENDING',
              assignedTeamId: teamId,
              assignedReviewerCount: reviewerCount,
            })
          );

          void base;

          const first = await selfAssignSession(user, sessionId);
          const countAfterFirst = first.assignedReviewerCount;
          const second = await selfAssignSession(user, sessionId);

          // Participant registered exactly once.
          expect(participants.size).toBe(1);
          // Reviewer count did not increase on the idempotent second call.
          expect(second.assignedReviewerCount).toBe(countAfterFirst);
          expect(reviewerCount).toBe(initialCount + 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: self-assign, Property 2: listJoinableSessions のスコープ健全性', () => {
  /**
   * **Validates: FR-1, NFR-1**
   *
   * For a REVIEWER, listJoinableSessions never returns a session that is not
   * PENDING, that is assigned to a team the reviewer does not belong to (per
   * the DynamoDB getUserTeamIds result, NOT the session's own assignedTeamId as
   * a membership claim), or that the reviewer already participates in. In other
   * words the result is always a subset of "DB-team-assigned PENDING, not yet
   * joined".
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('result only contains PENDING, own-team, not-yet-joined sessions for a REVIEWER', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(sessionArb, { maxLength: 20 }),
        fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 4 }),
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 10 }),
        async (allSessions, teamIds, joinedIds) => {
          const user: AuthUser = {
            userId: 'reviewer-1',
            email: 'r@example.com',
            displayName: 'R',
            role: 'REVIEWER',
          };

          const teamSet = new Set(teamIds);
          const joinedSet = new Set(joinedIds);

          // getSessionsByTeamId returns the sessions whose assignedTeamId equals
          // the queried team — this is the real GSI1 behaviour.
          mockedGetUserTeamIds.mockResolvedValue(teamIds);
          mockedGetSessionsByTeamId.mockImplementation(async (teamId: string) =>
            allSessions.filter((s) => s.assignedTeamId === teamId)
          );
          mockedGetSessionIdsByParticipantUserId.mockResolvedValue([...joinedSet]);

          const result = await listJoinableSessions(user);

          // ADMIN-only path must not be used for a REVIEWER.
          expect(mockedGetAllSessions).not.toHaveBeenCalled();

          for (const session of result) {
            // PENDING only
            expect(session.status).toBe('PENDING');
            // assigned to one of the reviewer's DB teams
            expect(session.assignedTeamId).toBeDefined();
            expect(teamSet.has(session.assignedTeamId as string)).toBe(true);
            // not already joined
            expect(joinedSet.has(session.sessionId)).toBe(false);
          }

          // No duplicate sessionIds in the result (de-dup invariant).
          const ids = result.map((s) => s.sessionId);
          expect(new Set(ids).size).toBe(ids.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
