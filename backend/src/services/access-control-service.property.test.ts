import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PutCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { AuthUser, UserRole } from '../utils/auth-middleware.js';
import { AppError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';

// ----------------------------------------------------------------------------
// In-memory DynamoDB table backing docClient.
//
// Property 2 (Preservation) is an observation-first test: it seeds the real
// Assignment data model (TeamMembership + TeamAssignment + ReviewAssignment)
// into this store and then drives the REAL getAccessibleSessionIds /
// checkSessionAccess against it. The expected result is computed by an
// independent reference reimplementation of the current (pre-fix) semantics,
// so the test fixes the baseline behaviour that the fix MUST NOT change.
//
// The engine supports exactly the command shapes those functions use:
//   - QueryCommand on the base table: `PK = :pk AND begins_with(SK, :prefix)`
//     and `PK = :pk AND SK = :sk`
//   - QueryCommand on GSI1: `GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)`
//   - PutCommand / GetCommand (for completeness / seeding)
// ----------------------------------------------------------------------------

interface TableItem extends Record<string, unknown> {
  PK: string;
  SK: string;
}

const store = new Map<string, TableItem>();

function keyOf(pk: string, sk: string): string {
  return `${pk}\u0000${sk}`;
}

function resolveValue(expr: string, values: Record<string, unknown>): string {
  return values[expr] as string;
}

async function fakeSend(command: unknown): Promise<unknown> {
  if (command instanceof PutCommand) {
    const item = command.input.Item as TableItem;
    store.set(keyOf(item.PK, item.SK), item);
    return {};
  }

  if (command instanceof GetCommand) {
    const key = command.input.Key as { PK: string; SK: string };
    return { Item: store.get(keyOf(key.PK, key.SK)) };
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

    const pkMatch = keyExpr.match(/=\s*(:[A-Za-z0-9_]+)/);
    const pkValue = pkMatch ? resolveValue(pkMatch[1], values) : undefined;

    const beginsMatch = keyExpr.match(
      /begins_with\([^,]+,\s*(:[A-Za-z0-9_]+)\)/
    );
    const prefix = beginsMatch
      ? resolveValue(beginsMatch[1], values)
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

    if (input.Limit !== undefined) {
      return { Items: items.slice(0, input.Limit) };
    }
    return { Items: items };
  }

  throw new Error(
    `fakeSend: unsupported command ${
      (command as { constructor?: { name?: string } })?.constructor?.name ??
      'unknown'
    }`
  );
}

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (command: unknown) => fakeSend(command) },
  TABLE_NAME: 'TestTable',
}));

import {
  getAccessibleSessionIds,
  checkSessionAccess,
} from './access-control-service.js';

// ----------------------------------------------------------------------------
// Seed helpers — mirror the real item layouts from team-repository.ts.
// ----------------------------------------------------------------------------

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

function seedTeamAssignment(teamId: string, sessionId: string): void {
  store.set(keyOf(`TEAM#${teamId}`, `ASSIGNMENT#${sessionId}`), {
    PK: `TEAM#${teamId}`,
    SK: `ASSIGNMENT#${sessionId}`,
    GSI1PK: `SESSION#${sessionId}`,
    GSI1SK: `TEAM#${teamId}`,
    entityType: 'TeamAssignment',
    teamId,
    sessionId,
    createdBy: 'admin',
    createdAt: '2024-01-01T00:00:00.000Z',
  });
}

function seedReviewAssignment(userId: string, sessionId: string): void {
  store.set(keyOf(`USER#${userId}`, `ASSIGNMENT#${sessionId}`), {
    PK: `USER#${userId}`,
    SK: `ASSIGNMENT#${sessionId}`,
    GSI1PK: `SESSION#${sessionId}`,
    GSI1SK: `USER#${userId}`,
    entityType: 'ReviewAssignment',
    userId,
    sessionId,
    createdBy: 'admin',
    createdAt: '2024-01-01T00:00:00.000Z',
  });
}

function makeUser(userId: string, role: UserRole): AuthUser {
  return {
    userId,
    email: `${userId}@example.com`,
    displayName: userId,
    role,
  };
}

const roleArb = fc.constantFrom<UserRole>('REVIEWER', 'TEAM_LEADER', 'ADMIN');

// ----------------------------------------------------------------------------
// Property 2: Preservation — existing Assignment-based visibility is unchanged.
// ----------------------------------------------------------------------------

describe('Feature: reviewer-uploaded-session-not-visible, Property 2: 既存可視性の不変（getAccessibleSessionIds）', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.6**
   *
   * Observation-first Preservation property. For any non-bug input
   * (isBugCondition_visibility(X) is false — i.e. sessions reachable through a
   * properly existing TeamAssignment / ReviewAssignment, or ADMIN callers, or
   * other-team / unassigned sessions that remain inaccessible), the behaviour of
   * getAccessibleSessionIds / checkSessionAccess must match the current (pre-fix)
   * implementation.
   *
   * This test fixes the baseline by comparing the real result to an independent
   * reference reimplementation of the current semantics:
   *   - ADMIN  -> null (all sessions) (bugfix 3.2)
   *   - non-ADMIN -> union of { sessionIds with a TeamAssignment on one of the
   *     caller's teams } and { sessionIds with a direct ReviewAssignment for the
   *     caller } (bugfix 3.1, 3.3)
   * It additionally asserts that other-team / unassigned sessions are denied by
   * checkSessionAccess with a 404 RESOURCE_NOT_FOUND (bugfix 3.6). Because the
   * fix (adopted approach A) only ADDS a ReviewAssignment for upload-derived
   * sessions and never changes the scan logic, this baseline must hold both
   * before and after the fix.
   */
  it('getAccessibleSessionIds が Assignment ベースの可視性を保持し、ADMIN は null（全件）、他チーム/未割り当ては 404', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          callerUserId: fc.string({ minLength: 1, maxLength: 8 }),
          role: roleArb,
          // Teams the caller belongs to.
          memberTeamIds: fc.uniqueArray(
            fc.string({ minLength: 1, maxLength: 6 }),
            { maxLength: 4 }
          ),
          // TeamAssignments: (teamId, sessionId) pairs. teamId may or may not be
          // one the caller belongs to (covers other-team sessions for 3.6).
          teamAssignments: fc.uniqueArray(
            fc.record({
              teamId: fc.string({ minLength: 1, maxLength: 6 }),
              sessionId: fc.string({ minLength: 1, maxLength: 10 }),
            }),
            { maxLength: 12, selector: (p) => `${p.teamId}\u0000${p.sessionId}` }
          ),
          // Direct ReviewAssignments for the caller.
          directSessionIds: fc.uniqueArray(
            fc.string({ minLength: 1, maxLength: 10 }),
            { maxLength: 8 }
          ),
          // A session that is neither team-assigned to the caller nor directly
          // assigned — used to assert the access-denial path (3.6).
          otherSessionId: fc.string({ minLength: 1, maxLength: 10 }),
        }),
        async (input) => {
          store.clear();

          const {
            callerUserId,
            role,
            memberTeamIds,
            teamAssignments,
            directSessionIds,
            otherSessionId,
          } = input;

          const caller = makeUser(callerUserId, role);

          // Seed the caller's team memberships.
          for (const teamId of memberTeamIds) {
            seedTeamMembership(callerUserId, teamId);
          }
          // Seed team assignments (some may be for other teams).
          for (const ta of teamAssignments) {
            seedTeamAssignment(ta.teamId, ta.sessionId);
          }
          // Seed direct review assignments for the caller.
          for (const sid of directSessionIds) {
            seedReviewAssignment(callerUserId, sid);
          }

          // --- Reference reimplementation of the CURRENT (pre-fix) semantics ---
          const memberTeamSet = new Set(memberTeamIds);
          const expectedIds = new Set<string>();
          for (const ta of teamAssignments) {
            if (memberTeamSet.has(ta.teamId)) {
              expectedIds.add(ta.sessionId);
            }
          }
          for (const sid of directSessionIds) {
            expectedIds.add(sid);
          }

          const result = await getAccessibleSessionIds(caller);

          if (role === 'ADMIN') {
            // bugfix 3.2: ADMIN always gets null (all sessions), regardless of
            // seeded assignments.
            expect(result).toBeNull();
          } else {
            // bugfix 3.1 / 3.3: non-ADMIN gets exactly the union of team- and
            // direct-assigned sessionIds. Order-independent set comparison.
            expect(result).not.toBeNull();
            expect(new Set(result as string[])).toEqual(expectedIds);
          }

          // --- bugfix 3.6: other-team / unassigned session is denied (404) ---
          // Only meaningful when otherSessionId is genuinely inaccessible: not a
          // direct assignment and not assigned to one of the caller's teams.
          const isDirect = directSessionIds.includes(otherSessionId);
          const isTeamAccessible = teamAssignments.some(
            (ta) =>
              ta.sessionId === otherSessionId && memberTeamSet.has(ta.teamId)
          );
          const accessible = isDirect || isTeamAccessible;

          if (role === 'ADMIN') {
            // ADMIN is never denied.
            await expect(
              checkSessionAccess(caller, otherSessionId)
            ).resolves.toBeUndefined();
          } else if (!accessible) {
            // Non-ADMIN with no access path: 404 RESOURCE_NOT_FOUND.
            try {
              await checkSessionAccess(caller, otherSessionId);
              throw new Error('expected checkSessionAccess to deny access');
            } catch (error) {
              expect(error).toBeInstanceOf(AppError);
              const appError = error as AppError;
              expect(appError.statusCode).toBe(404);
              expect(appError.errorCode).toBe(ERROR_CODES.RESOURCE_NOT_FOUND);
            }
          } else {
            // Non-ADMIN with a valid path: access granted (no throw).
            await expect(
              checkSessionAccess(caller, otherSessionId)
            ).resolves.toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
