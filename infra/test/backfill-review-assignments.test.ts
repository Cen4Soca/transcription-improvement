import { describe, it, expect } from 'vitest';
import {
  selectBackfillTargets,
  selectUploaderPerSession,
  parseArgs,
  type ParticipantRow,
  type SessionRow,
  type ReviewAssignmentRow,
  type TeamAssignmentRow,
  type UserRow,
} from '../scripts/backfill-review-assignments';

/**
 * **Validates: Requirements 2.1, 2.2, 2.3**
 * **Preservation: 3.1, 3.2, 3.6**
 *
 * Unit tests for the pure core logic of the visibility backfill script.
 * AWS I/O is not exercised here (the core functions are I/O-free); these tests
 * verify the dry-run decision logic: target extraction (role-independent, so
 * ADMIN uploaders are backfilled too — keeping visibility across a later role
 * downgrade), idempotent skip, team-assignment skip, unknown-user skip, and
 * uploader-only assignment.
 */

const sessions = (...ids: string[]): SessionRow[] =>
  ids.map((sessionId) => ({ sessionId }));

const participant = (
  sessionId: string,
  userId: string,
  joinedAt = '2024-01-01T00:00:00.000Z'
): ParticipantRow => ({ sessionId, userId, joinedAt });

const user = (userId: string, role: UserRow['role']): UserRow => ({
  userId,
  role,
});

describe('selectBackfillTargets', () => {
  it('creates a ReviewAssignment for a reviewer-uploaded orphan session', () => {
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [participant('s1', 'reviewer1')],
      reviewAssignments: [],
      teamAssignments: [],
      users: [user('reviewer1', 'REVIEWER')],
    });

    expect(plan.targets).toEqual([
      { userId: 'reviewer1', sessionId: 's1', createdBy: 'reviewer1' },
    ]);
  });

  it('creates a ReviewAssignment for a team-leader-uploaded orphan session', () => {
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [participant('s1', 'lead1')],
      reviewAssignments: [],
      teamAssignments: [],
      users: [user('lead1', 'TEAM_LEADER')],
    });

    expect(plan.targets).toEqual([
      { userId: 'lead1', sessionId: 's1', createdBy: 'lead1' },
    ]);
  });

  it('includes ADMIN uploaders so visibility survives a later role downgrade', () => {
    // Mirrors createSessionForJob, which creates a ReviewAssignment regardless
    // of uploader role. Backfilling ADMIN uploads is harmless while the user is
    // still ADMIN (getAccessibleSessionIds returns null = all sessions) and
    // keeps the uploaded session visible if the user is later downgraded to a
    // non-ADMIN role.
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [participant('s1', 'admin1')],
      reviewAssignments: [],
      teamAssignments: [],
      users: [user('admin1', 'ADMIN')],
    });

    expect(plan.targets).toEqual([
      { userId: 'admin1', sessionId: 's1', createdBy: 'admin1' },
    ]);
    expect(plan.skippedAdminUploader).toBe(0);
  });

  it('skips sessions that already have a ReviewAssignment (idempotency)', () => {
    const reviewAssignments: ReviewAssignmentRow[] = [
      { userId: 'reviewer1', sessionId: 's1' },
    ];
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [participant('s1', 'reviewer1')],
      reviewAssignments,
      teamAssignments: [],
      users: [user('reviewer1', 'REVIEWER')],
    });

    expect(plan.targets).toHaveLength(0);
    expect(plan.skippedExistingAssignment).toBe(1);
  });

  it('skips sessions that already have a TeamAssignment', () => {
    const teamAssignments: TeamAssignmentRow[] = [
      { teamId: 'team1', sessionId: 's1' },
    ];
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [participant('s1', 'reviewer1')],
      reviewAssignments: [],
      teamAssignments,
      users: [user('reviewer1', 'REVIEWER')],
    });

    expect(plan.targets).toHaveLength(0);
    expect(plan.skippedHasTeamAssignment).toBe(1);
  });

  it('skips participants whose user record cannot be resolved', () => {
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [participant('s1', 'ghost')],
      reviewAssignments: [],
      teamAssignments: [],
      users: [],
    });

    expect(plan.targets).toHaveLength(0);
    expect(plan.skippedUnknownUser).toBe(1);
  });

  it('ignores participant rows for sessions with no METADATA row', () => {
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [participant('sMissing', 'reviewer1')],
      reviewAssignments: [],
      teamAssignments: [],
      users: [user('reviewer1', 'REVIEWER')],
    });

    expect(plan.targets).toHaveLength(0);
  });

  it('only assigns the uploader (earliest-joined participant), never later reviewers', () => {
    const plan = selectBackfillTargets({
      sessions: sessions('s1'),
      participants: [
        participant('s1', 'uploader', '2024-01-01T00:00:00.000Z'),
        participant('s1', 'laterReviewer', '2024-02-01T00:00:00.000Z'),
      ],
      reviewAssignments: [],
      teamAssignments: [],
      users: [
        user('uploader', 'REVIEWER'),
        user('laterReviewer', 'REVIEWER'),
      ],
    });

    expect(plan.targets).toEqual([
      { userId: 'uploader', sessionId: 's1', createdBy: 'uploader' },
    ]);
  });

  it('produces a deterministic, sorted list of targets across many sessions', () => {
    const plan = selectBackfillTargets({
      sessions: sessions('s3', 's1', 's2'),
      participants: [
        participant('s3', 'r3'),
        participant('s1', 'r1'),
        participant('s2', 'r2'),
      ],
      reviewAssignments: [],
      teamAssignments: [],
      users: [
        user('r1', 'REVIEWER'),
        user('r2', 'TEAM_LEADER'),
        user('r3', 'REVIEWER'),
      ],
    });

    expect(plan.targets.map((t) => t.sessionId)).toEqual(['s1', 's2', 's3']);
  });

  it('is idempotent: re-running after a backfill yields zero new targets', () => {
    const input = {
      sessions: sessions('s1'),
      participants: [participant('s1', 'reviewer1')],
      teamAssignments: [] as TeamAssignmentRow[],
      users: [user('reviewer1', 'REVIEWER')],
    };

    const first = selectBackfillTargets({ ...input, reviewAssignments: [] });
    expect(first.targets).toHaveLength(1);

    // Simulate the assignment written by the first run.
    const written: ReviewAssignmentRow[] = first.targets.map((t) => ({
      userId: t.userId,
      sessionId: t.sessionId,
    }));

    const second = selectBackfillTargets({
      ...input,
      reviewAssignments: written,
    });
    expect(second.targets).toHaveLength(0);
    expect(second.skippedExistingAssignment).toBe(1);
  });

  it('counts a representative mixed dataset correctly (ADMIN uploads are targeted, closing the downgrade edge)', () => {
    const plan = selectBackfillTargets({
      sessions: sessions('orphan', 'adminUp', 'hasTeam', 'alreadyAssigned'),
      participants: [
        participant('orphan', 'reviewer1'),
        participant('adminUp', 'admin1'),
        participant('hasTeam', 'reviewer2'),
        participant('alreadyAssigned', 'reviewer3'),
      ],
      reviewAssignments: [{ userId: 'reviewer3', sessionId: 'alreadyAssigned' }],
      teamAssignments: [{ teamId: 'team1', sessionId: 'hasTeam' }],
      users: [
        user('reviewer1', 'REVIEWER'),
        user('admin1', 'ADMIN'),
        user('reviewer2', 'REVIEWER'),
        user('reviewer3', 'REVIEWER'),
      ],
    });

    // The ADMIN upload (adminUp) is now a target too, so its uploaded session
    // stays visible if admin1 is later downgraded. Targets are sorted by
    // sessionId ('adminUp' < 'orphan').
    expect(plan.targets).toEqual([
      { userId: 'admin1', sessionId: 'adminUp', createdBy: 'admin1' },
      { userId: 'reviewer1', sessionId: 'orphan', createdBy: 'reviewer1' },
    ]);
    expect(plan.skippedAdminUploader).toBe(0);
    expect(plan.skippedHasTeamAssignment).toBe(1);
    expect(plan.skippedExistingAssignment).toBe(1);
  });
});

describe('selectUploaderPerSession', () => {
  it('picks the earliest-joined participant per session', () => {
    const map = selectUploaderPerSession([
      participant('s1', 'late', '2024-03-01T00:00:00.000Z'),
      participant('s1', 'early', '2024-01-01T00:00:00.000Z'),
      participant('s2', 'solo', '2024-01-01T00:00:00.000Z'),
    ]);

    expect(map.get('s1')).toBe('early');
    expect(map.get('s2')).toBe('solo');
  });

  it('breaks ties deterministically on userId', () => {
    const ts = '2024-01-01T00:00:00.000Z';
    const map = selectUploaderPerSession([
      participant('s1', 'bbb', ts),
      participant('s1', 'aaa', ts),
    ]);

    expect(map.get('s1')).toBe('aaa');
  });
});

describe('parseArgs', () => {
  it('defaults to dry-run / dev', () => {
    expect(parseArgs([])).toEqual({ execute: false, env: 'dev', help: false });
  });

  it('parses --execute', () => {
    expect(parseArgs(['--execute']).execute).toBe(true);
  });

  it('parses --dryrun as the non-executing mode', () => {
    expect(parseArgs(['--execute', '--dryrun']).execute).toBe(false);
  });

  it('parses --env values', () => {
    expect(parseArgs(['--env', 'staging']).env).toBe('staging');
    expect(parseArgs(['--env', 'prod']).env).toBe('prod');
  });

  it('parses --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('rejects an invalid --env value', () => {
    expect(() => parseArgs(['--env', 'production'])).toThrow(/Invalid --env/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});
