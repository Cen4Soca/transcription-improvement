import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  PutCommand,
  QueryCommand,
  GetCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AuthUser } from '../utils/auth-middleware.js';

// ----------------------------------------------------------------------------
// In-memory DynamoDB table backing docClient.
//
// The real createSession (session-repository) WRITES items here and the real
// getAccessibleSessionIds / getUserTeamIds / getSessionsByParticipantUserId
// (access-control-service / session-repository) READ from here. This lets the
// end-to-end data model (base table + GSI1 + GSI2) drive the test rather than
// stubbed return values, so the visibility inconsistency is reproduced exactly
// as it happens against DynamoDB.
// ----------------------------------------------------------------------------

interface TableItem extends Record<string, unknown> {
  PK: string;
  SK: string;
}

const store = new Map<string, TableItem>();

function keyOf(pk: string, sk: string): string {
  return `${pk}\u0000${sk}`;
}

function resolveValue(
  expr: string,
  values: Record<string, unknown>
): string {
  // expr is an ExpressionAttributeValue placeholder like ":pk".
  return values[expr] as string;
}

/**
 * Minimal DynamoDB engine supporting exactly the command shapes used by the
 * functions under test: PutCommand, GetCommand, BatchGetCommand, and
 * QueryCommand on the base table, GSI1, and GSI2 with
 * `<PK> = :x AND begins_with(<SK>, :prefix)`.
 */
async function fakeSend(command: unknown): Promise<unknown> {
  if (command instanceof PutCommand) {
    const item = command.input.Item as TableItem;
    store.set(keyOf(item.PK, item.SK), item);
    return {};
  }

  if (command instanceof GetCommand) {
    const key = command.input.Key as { PK: string; SK: string };
    const item = store.get(keyOf(key.PK, key.SK));
    return { Item: item };
  }

  if (command instanceof BatchGetCommand) {
    const requestItems = command.input.RequestItems ?? {};
    const responses: Record<string, TableItem[]> = {};
    for (const [tableName, spec] of Object.entries(requestItems)) {
      const keys = (spec as { Keys: { PK: string; SK: string }[] }).Keys ?? [];
      const found: TableItem[] = [];
      for (const k of keys) {
        const item = store.get(keyOf(k.PK, k.SK));
        if (item) {
          found.push(item);
        }
      }
      responses[tableName] = found;
    }
    return { Responses: responses };
  }

  if (command instanceof QueryCommand) {
    const input = command.input;
    const keyExpr = input.KeyConditionExpression ?? '';
    const values = (input.ExpressionAttributeValues ?? {}) as Record<
      string,
      unknown
    >;
    const indexName = input.IndexName;

    const pkAttr = indexName ? `${indexName}PK` : 'PK';
    const skAttr = indexName ? `${indexName}SK` : 'SK';

    // Parse "<pkAttr> = :pk AND begins_with(<skAttr>, :prefix)".
    const pkMatch = keyExpr.match(/=\s*(:[A-Za-z0-9_]+)/);
    const pkValuePlaceholder = pkMatch ? pkMatch[1] : undefined;
    const pkValue = pkValuePlaceholder
      ? resolveValue(pkValuePlaceholder, values)
      : undefined;

    const beginsMatch = keyExpr.match(/begins_with\([^,]+,\s*(:[A-Za-z0-9_]+)\)/);
    const prefixPlaceholder = beginsMatch ? beginsMatch[1] : undefined;
    const prefix = prefixPlaceholder
      ? resolveValue(prefixPlaceholder, values)
      : undefined;

    const exactSkMatch = keyExpr.match(/AND\s+SK\s*=\s*(:[A-Za-z0-9_]+)/);
    const exactSk = exactSkMatch
      ? resolveValue(exactSkMatch[1], values)
      : undefined;

    const items: TableItem[] = [];
    for (const item of store.values()) {
      if (item[pkAttr] !== pkValue) {
        continue;
      }
      const skVal = item[skAttr] as string | undefined;
      if (skVal === undefined) {
        continue;
      }
      if (exactSk !== undefined && skVal !== exactSk) {
        continue;
      }
      if (prefix !== undefined && !skVal.startsWith(prefix)) {
        continue;
      }
      items.push(item);
    }

    if (input.Select === 'COUNT') {
      return { Count: items.length };
    }

    return { Items: items };
  }

  throw new Error(
    `fakeSend: unsupported command ${(command as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown'}`
  );
}

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (command: unknown) => fakeSend(command) },
  TABLE_NAME: 'TestTable',
}));

// createReviewAssignment is the repository call the FIX (adopted approach A) adds
// to createSessionForJob. Model it with the real key layout so that, once the fix
// calls it, the ReviewAssignment item lands in the same in-memory table and the
// direct-assignment path of getAccessibleSessionIds can see it. The unfixed code
// never calls this, so no ReviewAssignment is written and the session stays
// invisible to the list path — which is exactly what this exploration test proves.
vi.mock('../repositories/team-repository.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../repositories/team-repository.js')
  >();
  return {
    ...actual,
    createReviewAssignment: vi.fn(
      async (input: { userId: string; sessionId: string; createdBy: string }) => {
        const now = new Date().toISOString();
        store.set(keyOf(`USER#${input.userId}`, `ASSIGNMENT#${input.sessionId}`), {
          PK: `USER#${input.userId}`,
          SK: `ASSIGNMENT#${input.sessionId}`,
          GSI1PK: `SESSION#${input.sessionId}`,
          GSI1SK: `USER#${input.userId}`,
          entityType: 'ReviewAssignment',
          userId: input.userId,
          sessionId: input.sessionId,
          createdBy: input.createdBy,
          createdAt: now,
        });
        return {
          userId: input.userId,
          sessionId: input.sessionId,
          createdBy: input.createdBy,
          createdAt: now,
        };
      }
    ),
  };
});

import { createSessionForJob, getAssignedSessions } from './session-service.js';
import { getAccessibleSessionIds } from './access-control-service.js';

/**
 * Seed a team membership so getUserTeamIds(userId) resolves to teamId.
 * Mirrors the real TeamMembership item indexed on GSI1
 * (GSI1PK=USER#{userId}, GSI1SK=TEAM#{teamId}).
 */
function seedTeamMembership(userId: string, teamId: string): void {
  store.set(keyOf(`TEAM#${teamId}`, `MEMBER#${userId}`), {
    PK: `TEAM#${teamId}`,
    SK: `MEMBER#${userId}`,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `TEAM#${teamId}`,
    entityType: 'TeamMembership',
    userId,
    teamId,
  });
}

// ----------------------------------------------------------------------------
// Property 1: Bug Condition — upload-derived session missing from the list.
// ----------------------------------------------------------------------------

describe('Feature: reviewer-uploaded-session-not-visible, Property 1: 可視性の不整合（アップロード由来セッションが一覧に出ない）', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * Bug condition isBugCondition_visibility(X): an upload-derived session
   * (generatedFromUpload=true) for which neither a TeamAssignment
   * (PK=TEAM#{teamId}, SK=ASSIGNMENT#{sessionId}) nor a ReviewAssignment
   * (PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}) exists, while the operating
   * user is the uploader themselves (entitled). For every such input this test
   * asserts that createSessionForJob followed by getAccessibleSessionIds(uploader)
   * does NOT contain the sessionId, yet getAssignedSessions(uploader) DOES — the
   * list/my-tasks visibility inconsistency.
   *
   * Covers both affected non-ADMIN uploader roles:
   *   - REVIEWER with mediaFile.teamId unset (no GSI1 at all)
   *   - TEAM_LEADER with mediaFile.teamId set (GSI1 `SESSION#` item is written,
   *     but getAccessibleSessionIds' team path scans `TeamAssignment`
   *     (`ASSIGNMENT#` prefix) items, so the `SESSION#` GSI1 item is never
   *     picked up: GSI1 `SESSION#` != TeamAssignment `ASSIGNMENT#`).
   *
   * This test ENCODES the expected (post-fix) behaviour — it must FAIL on the
   * unfixed code (the failure proves the bug exists) and PASS after the fix.
   */
  it('upload 由来セッションが getAccessibleSessionIds に含まれ、assigned ⊆ listed の整合が保たれる（REVIEWER / TEAM_LEADER）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          uploaderUserId: fc.string({ minLength: 1, maxLength: 12 }),
          jobId: fc.string({ minLength: 1, maxLength: 12 }),
          sessionName: fc.string({ minLength: 1, maxLength: 20 }),
          // Uploader role: both non-ADMIN roles are affected by the visibility defect.
          role: fc.constantFrom<'REVIEWER' | 'TEAM_LEADER'>(
            'REVIEWER',
            'TEAM_LEADER'
          ),
          // mediaFile.teamId: undefined (Reviewer case) or set (TeamLeader case).
          teamId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
            nil: undefined,
          }),
        }),
        async ({ uploaderUserId, jobId, sessionName, role, teamId }) => {
          store.clear();

          const uploader: AuthUser = {
            userId: uploaderUserId,
            email: `${uploaderUserId}@example.com`,
            displayName: 'Uploader',
            role,
          };

          // If the uploader's media carries a teamId, the uploader must be a
          // member of that team for the team-scoped list path to even apply.
          // This makes the TeamLeader teamId-set case faithful (and still shows
          // the session is absent because the GSI1 `SESSION#` item is not an
          // `ASSIGNMENT#` item).
          if (teamId) {
            seedTeamMembership(uploaderUserId, teamId);
          }

          // Act: create the session exactly as the upload flow does — assigning
          // the uploader as participant and passing mediaFile.teamId through.
          const session = await createSessionForJob(
            jobId,
            sessionName,
            teamId,
            uploaderUserId
          );

          const listed = await getAccessibleSessionIds(uploader);
          const assigned = await getAssignedSessions(uploaderUserId);
          const assignedIds = assigned.map((s) => s.sessionId);

          // My-tasks (SessionParticipant via GSI2) always surfaces the session.
          expect(assignedIds).toContain(session.sessionId);

          // Non-ADMIN uploaders get a concrete accessible-id set (never null).
          expect(listed).not.toBeNull();
          const listedIds = listed as string[];

          // Expected (post-fix) behaviour: the upload-derived session is visible
          // in the list, and anything in my-tasks is also in the list.
          expect(listedIds).toContain(session.sessionId);
          expect(listedIds).toEqual(expect.arrayContaining(assignedIds));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ----------------------------------------------------------------------------
// Pre-existing self-assign properties (preserved). These exercise
// selfAssignSession / listJoinableSessions and are spied onto the real
// repository / access-control functions so they share the same module graph as
// the Property 1 test above (which needs the real implementations).
// ----------------------------------------------------------------------------

import type { SessionRecord } from '../repositories/session-repository.js';
import * as sessionRepo from '../repositories/session-repository.js';
import * as accessControl from './access-control-service.js';
import { selfAssignSession, listJoinableSessions } from './session-service.js';

const statusArb = fc.constantFrom<SessionRecord['status']>(
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED'
);

function makeSession(
  overrides: Partial<SessionRecord> & { sessionId: string }
): SessionRecord {
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
    assignedTeamId: fc.option(fc.string({ minLength: 1, maxLength: 6 }), {
      nil: undefined,
    }),
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
   * twice registers the participant exactly once and the reviewer count is never
   * double-counted.
   */
  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
  });

  it('calling twice does not double-count the reviewer or duplicate the participant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 50 }),
        async (sessionId, teamId, initialCount) => {
          const user: AuthUser = {
            userId: 'reviewer-1',
            email: 'r@example.com',
            displayName: 'R',
            role: 'REVIEWER',
          };

          const participants = new Set<string>();
          let reviewerCount = initialCount;

          const isTeamMemberSpy = vi
            .spyOn(accessControl, 'isTeamMember')
            .mockResolvedValue(true);
          const addParticipantSpy = vi
            .spyOn(sessionRepo, 'addParticipant')
            .mockImplementation(async (sid: string, uid: string) => {
              expect(sid).toBe(sessionId);
              expect(uid).toBe(user.userId);
              if (participants.has(uid)) {
                return false;
              }
              participants.add(uid);
              reviewerCount += 1;
              return true;
            });
          const getSessionByIdSpy = vi
            .spyOn(sessionRepo, 'getSessionById')
            .mockImplementation(async () =>
              makeSession({
                sessionId,
                status: 'PENDING',
                assignedTeamId: teamId,
                assignedReviewerCount: reviewerCount,
              })
            );

          const first = await selfAssignSession(user, sessionId);
          const countAfterFirst = first.assignedReviewerCount;
          const second = await selfAssignSession(user, sessionId);

          expect(participants.size).toBe(1);
          expect(second.assignedReviewerCount).toBe(countAfterFirst);
          expect(reviewerCount).toBe(initialCount + 1);

          isTeamMemberSpy.mockRestore();
          addParticipantSpy.mockRestore();
          getSessionByIdSpy.mockRestore();
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
   * PENDING, that is assigned to a team the reviewer does not belong to, or that
   * the reviewer already participates in.
   */
  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
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

          const getUserTeamIdsSpy = vi
            .spyOn(accessControl, 'getUserTeamIds')
            .mockResolvedValue(teamIds);
          const getSessionsByTeamIdSpy = vi
            .spyOn(sessionRepo, 'getSessionsByTeamId')
            .mockImplementation(async (teamId: string) =>
              allSessions.filter((s) => s.assignedTeamId === teamId)
            );
          const getAllSessionsSpy = vi.spyOn(sessionRepo, 'getAllSessions');
          const getSessionIdsSpy = vi
            .spyOn(sessionRepo, 'getSessionIdsByParticipantUserId')
            .mockResolvedValue([...joinedSet]);

          const result = await listJoinableSessions(user);

          expect(getAllSessionsSpy).not.toHaveBeenCalled();

          for (const session of result) {
            expect(session.status).toBe('PENDING');
            expect(session.assignedTeamId).toBeDefined();
            expect(teamSet.has(session.assignedTeamId as string)).toBe(true);
            expect(joinedSet.has(session.sessionId)).toBe(false);
          }

          const ids = result.map((s) => s.sessionId);
          expect(new Set(ids).size).toBe(ids.length);

          getUserTeamIdsSpy.mockRestore();
          getSessionsByTeamIdSpy.mockRestore();
          getAllSessionsSpy.mockRestore();
          getSessionIdsSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});
