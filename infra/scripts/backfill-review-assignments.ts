/**
 * backfill-review-assignments.ts - Visibility backfill for reviewer/team-leader uploaded sessions
 *
 * Usage:
 *   npx ts-node scripts/backfill-review-assignments.ts [OPTIONS]
 *   npm run backfill:review-assignments -- [OPTIONS]
 *
 * Options:
 *   --dryrun       Show what would be created without writing (default)
 *   --execute      Actually create the missing ReviewAssignment records
 *   --env ENV      Target environment label (dev|staging|prod). Default: dev
 *                  prod requires an explicit interactive confirmation.
 *   --help, -h     Show this help message
 *
 * Environment variables:
 *   DYNAMODB_TABLE_NAME  DynamoDB table name. Default: TranscriptionReviewApp
 *   AWS_REGION           AWS region. Default: ap-northeast-1
 *   (AWS credentials are resolved by the default AWS SDK provider chain.)
 *
 * Examples:
 *   npx ts-node scripts/backfill-review-assignments.ts --dryrun           # Preview (default)
 *   npx ts-node scripts/backfill-review-assignments.ts --execute          # Write for dev
 *   npx ts-node scripts/backfill-review-assignments.ts --execute --env prod
 *
 * What it does:
 *   Sessions created before the visibility fix by a Reviewer / TeamLeader upload
 *   have a SessionParticipant (the uploader) but NO ReviewAssignment, so
 *   getAccessibleSessionIds() never returns them and they are missing from the
 *   session list. This script scans SessionParticipant records and creates the
 *   matching ReviewAssignment for the uploader, restoring list visibility.
 *
 * Target scope (strict):
 *   - Only sessions that have NEITHER a ReviewAssignment NOR a TeamAssignment
 *     (i.e. genuinely orphaned uploads).
 *   - The uploader's role does NOT matter: ADMIN uploads are backfilled too.
 *     Rationale: this mirrors createSessionForJob, which creates a
 *     ReviewAssignment for the uploader regardless of role, so a later role
 *     downgrade (ADMIN -> non-ADMIN) keeps the uploaded session visible. While
 *     the user is still ADMIN, getAccessibleSessionIds() returns null (all
 *     sessions), so the extra ReviewAssignment is harmless; it only takes effect
 *     after a downgrade to a non-ADMIN role.
 *   - The uploader must be resolvable (a User record must exist). Participants
 *     whose user record cannot be resolved are still skipped.
 *   - A ReviewAssignment is only created for the uploader themselves (the
 *     SessionParticipant userId). No assignment is ever created for another user.
 *
 * Idempotency:
 *   Writes use the fixed-key layout of createReviewAssignment
 *   (PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}). An existing (userId, sessionId)
 *   pair is skipped, so re-running produces no duplicates or side effects.
 *
 * Safety / data residency:
 *   - dry-run is the default; --execute is required to write.
 *   - The script never logs secrets or credentials; it logs only session/user ids.
 *   - Region defaults to ap-northeast-1 (matches the app's data residency).
 */

import * as readline from 'node:readline';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

// ============================================================
// Types (mirror the backend single-table record shapes)
// ============================================================

export type UserRole = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';

/** ReviewSession METADATA record (PK=SESSION#{id}, SK=METADATA). */
export interface SessionRow {
  sessionId: string;
}

/** SessionParticipant record (PK=SESSION#{id}, SK=PARTICIPANT#{userId}). */
export interface ParticipantRow {
  sessionId: string;
  userId: string;
  joinedAt: string;
}

/** ReviewAssignment record (PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}). */
export interface ReviewAssignmentRow {
  userId: string;
  sessionId: string;
}

/** TeamAssignment record (PK=TEAM#{teamId}, SK=ASSIGNMENT#{sessionId}). */
export interface TeamAssignmentRow {
  teamId: string;
  sessionId: string;
}

/** User METADATA record (PK=USER#{userId}, SK=METADATA). */
export interface UserRow {
  userId: string;
  role: UserRole;
}

/** A ReviewAssignment that the backfill would (or did) create. */
export interface BackfillTarget {
  userId: string;
  sessionId: string;
  createdBy: string;
}

export interface BackfillPlan {
  targets: BackfillTarget[];
  /** Sessions skipped because a ReviewAssignment already exists for the uploader. */
  skippedExistingAssignment: number;
  /** Sessions skipped because the session already has a TeamAssignment. */
  skippedHasTeamAssignment: number;
  /**
   * Always 0. ADMIN uploaders are no longer skipped (they are backfilled like
   * any other role to survive a later role downgrade). Retained for backward
   * compatibility with the dry-run output shape.
   */
  skippedAdminUploader: number;
  /** Participants skipped because the user record could not be resolved. */
  skippedUnknownUser: number;
}

// ============================================================
// Pure core logic (no I/O — unit tested in isolation)
// ============================================================

/**
 * Decide which ReviewAssignment records should be created to restore
 * visibility of orphaned Reviewer / TeamLeader uploads.
 *
 * A (uploader, session) pair is a backfill target when ALL of the following hold:
 *   1. The session exists (has a METADATA row).
 *   2. The session has NO TeamAssignment (would already be visible via the team).
 *   3. The uploader has NO existing ReviewAssignment for the session (idempotency).
 *   4. The uploader is resolvable (a User record exists). The uploader's role
 *      does NOT matter — ADMIN uploads are backfilled too, mirroring
 *      createSessionForJob, so visibility survives a later role downgrade.
 *
 * The uploader is the SessionParticipant. When a session has multiple
 * participants (later reviewers joined), the earliest-joined participant is
 * treated as the uploader so we never create an assignment for a non-uploader.
 *
 * This function is pure: it performs no I/O and does not mutate its inputs.
 */
export function selectBackfillTargets(input: {
  sessions: SessionRow[];
  participants: ParticipantRow[];
  reviewAssignments: ReviewAssignmentRow[];
  teamAssignments: TeamAssignmentRow[];
  users: UserRow[];
}): BackfillPlan {
  const { sessions, participants, reviewAssignments, teamAssignments, users } =
    input;

  const sessionIds = new Set(sessions.map((s) => s.sessionId));

  const sessionsWithTeamAssignment = new Set(
    teamAssignments.map((t) => t.sessionId)
  );

  const existingReviewAssignments = new Set(
    reviewAssignments.map((a) => assignmentKey(a.userId, a.sessionId))
  );

  const roleByUserId = new Map<string, UserRole>(
    users.map((u) => [u.userId, u.role])
  );

  // Pick the uploader per session: the earliest-joined participant. Sorting is
  // stable on joinedAt so repeated runs always select the same uploader.
  const uploaderBySession = selectUploaderPerSession(participants);

  const plan: BackfillPlan = {
    targets: [],
    skippedExistingAssignment: 0,
    skippedHasTeamAssignment: 0,
    skippedAdminUploader: 0,
    skippedUnknownUser: 0,
  };

  for (const [sessionId, uploaderId] of uploaderBySession) {
    // 1. Session must actually exist.
    if (!sessionIds.has(sessionId)) {
      continue;
    }

    // 2. Skip sessions already visible through a team assignment.
    if (sessionsWithTeamAssignment.has(sessionId)) {
      plan.skippedHasTeamAssignment += 1;
      continue;
    }

    // 3. Idempotency: skip if the uploader already has a ReviewAssignment.
    if (existingReviewAssignments.has(assignmentKey(uploaderId, sessionId))) {
      plan.skippedExistingAssignment += 1;
      continue;
    }

    // 4. The uploader must be resolvable; skip unknown users. Role is NOT a
    //    filter: ADMIN uploaders are backfilled too, matching
    //    createSessionForJob, so the session stays visible after a later
    //    downgrade (ADMIN -> non-ADMIN). While still ADMIN,
    //    getAccessibleSessionIds returns null (all sessions) so the extra
    //    ReviewAssignment is harmless.
    const role = roleByUserId.get(uploaderId);
    if (role === undefined) {
      plan.skippedUnknownUser += 1;
      continue;
    }

    plan.targets.push({
      userId: uploaderId,
      sessionId,
      // The assignment is created "by" the uploader themselves.
      createdBy: uploaderId,
    });
  }

  // Deterministic ordering for stable dry-run output.
  plan.targets.sort((a, b) =>
    a.sessionId === b.sessionId
      ? a.userId.localeCompare(b.userId)
      : a.sessionId.localeCompare(b.sessionId)
  );

  return plan;
}

/**
 * For each session, choose the uploader = the earliest-joined participant.
 * Returns a map of sessionId -> uploader userId.
 */
export function selectUploaderPerSession(
  participants: ParticipantRow[]
): Map<string, string> {
  const earliest = new Map<string, ParticipantRow>();

  for (const p of participants) {
    const current = earliest.get(p.sessionId);
    if (current === undefined || isEarlier(p, current)) {
      earliest.set(p.sessionId, p);
    }
  }

  const result = new Map<string, string>();
  for (const [sessionId, p] of earliest) {
    result.set(sessionId, p.userId);
  }
  return result;
}

function isEarlier(a: ParticipantRow, b: ParticipantRow): boolean {
  if (a.joinedAt !== b.joinedAt) {
    return a.joinedAt < b.joinedAt;
  }
  // Tie-break deterministically on userId so selection is stable.
  return a.userId < b.userId;
}

function assignmentKey(userId: string, sessionId: string): string {
  return `${userId}\u0000${sessionId}`;
}

// ============================================================
// CLI argument parsing (pure)
// ============================================================

export interface CliOptions {
  execute: boolean;
  env: 'dev' | 'staging' | 'prod';
  help: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false, env: 'dev', help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dryrun':
        options.execute = false;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--env': {
        const value = argv[i + 1];
        if (value === 'dev' || value === 'staging' || value === 'prod') {
          options.env = value;
        } else {
          throw new Error(
            `Invalid --env value: ${String(value)}. Expected dev|staging|prod.`
          );
        }
        i += 1;
        break;
      }
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

const HELP_TEXT = `backfill-review-assignments.ts - Visibility backfill for reviewer/team-leader uploaded sessions

Usage:
  npx ts-node scripts/backfill-review-assignments.ts [OPTIONS]

Options:
  --dryrun       Show what would be created without writing (default)
  --execute      Actually create the missing ReviewAssignment records
  --env ENV      Target environment (dev|staging|prod). Default: dev
  --help, -h     Show this help message

Environment variables:
  DYNAMODB_TABLE_NAME  DynamoDB table name (default: TranscriptionReviewApp)
  AWS_REGION           AWS region (default: ap-northeast-1)
`;

// ============================================================
// DynamoDB I/O
// ============================================================

const TABLE_NAME =
  process.env.DYNAMODB_TABLE_NAME ?? 'TranscriptionReviewApp';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

function createDocClient(): DynamoDBDocumentClient {
  const ddbClient = new DynamoDBClient({ region: REGION });
  return DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/** Scan the whole table once and bucket items by entityType. */
async function loadTable(doc: DynamoDBDocumentClient): Promise<{
  sessions: SessionRow[];
  participants: ParticipantRow[];
  reviewAssignments: ReviewAssignmentRow[];
  teamAssignments: TeamAssignmentRow[];
  users: UserRow[];
}> {
  const sessions: SessionRow[] = [];
  const participants: ParticipantRow[] = [];
  const reviewAssignments: ReviewAssignmentRow[] = [];
  const teamAssignments: TeamAssignmentRow[] = [];
  const users: UserRow[] = [];

  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      })
    );

    for (const item of result.Items ?? []) {
      const entityType = item['entityType'] as string | undefined;
      switch (entityType) {
        case 'ReviewSession':
          sessions.push({ sessionId: item['sessionId'] as string });
          break;
        case 'SessionParticipant':
          participants.push({
            sessionId: item['sessionId'] as string,
            userId: item['userId'] as string,
            joinedAt: (item['joinedAt'] as string | undefined) ?? '',
          });
          break;
        case 'ReviewAssignment':
          reviewAssignments.push({
            userId: item['userId'] as string,
            sessionId: item['sessionId'] as string,
          });
          break;
        case 'TeamAssignment':
          teamAssignments.push({
            teamId: item['teamId'] as string,
            sessionId: item['sessionId'] as string,
          });
          break;
        case 'User':
          users.push({
            userId: item['userId'] as string,
            role: item['role'] as UserRole,
          });
          break;
        default:
          break;
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  return { sessions, participants, reviewAssignments, teamAssignments, users };
}

/**
 * Write a single ReviewAssignment using the exact key layout of
 * createReviewAssignment (team-repository.ts). Fixed-key PUT => idempotent.
 */
async function writeReviewAssignment(
  doc: DynamoDBDocumentClient,
  target: BackfillTarget
): Promise<void> {
  const now = new Date().toISOString();

  await doc.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${target.userId}`,
        SK: `ASSIGNMENT#${target.sessionId}`,
        GSI1PK: `SESSION#${target.sessionId}`,
        GSI1SK: `USER#${target.userId}`,
        entityType: 'ReviewAssignment',
        userId: target.userId,
        sessionId: target.sessionId,
        createdBy: target.createdBy,
        createdAt: now,
      },
    })
  );
}

// ============================================================
// Logging helpers (styled after destroy.sh)
// ============================================================

const RED = '\u001b[0;31m';
const GREEN = '\u001b[0;32m';
const YELLOW = '\u001b[1;33m';
const BLUE = '\u001b[0;34m';
const NC = '\u001b[0m';

function logInfo(msg: string): void {
  console.log(`${BLUE}[INFO]${NC} ${msg}`);
}
function logWarn(msg: string): void {
  console.log(`${YELLOW}[WARN]${NC} ${msg}`);
}
function logError(msg: string): void {
  console.error(`${RED}[ERROR]${NC} ${msg}`);
}
function logSuccess(msg: string): void {
  console.log(`${GREEN}[OK]${NC} ${msg}`);
}

function printPlanSummary(plan: BackfillPlan): void {
  logInfo(`ReviewAssignments to create: ${plan.targets.length}`);
  logInfo(`  Skipped (already assigned):     ${plan.skippedExistingAssignment}`);
  logInfo(`  Skipped (has team assignment):  ${plan.skippedHasTeamAssignment}`);
  // Always 0: ADMIN uploaders are backfilled like any other role (kept for
  // backward-compatible output).
  logInfo(`  Skipped (ADMIN uploader):       ${plan.skippedAdminUploader}`);
  logInfo(`  Skipped (unknown user):         ${plan.skippedUnknownUser}`);

  if (plan.targets.length > 0) {
    logInfo('Target sessions (uploader -> session):');
    for (const t of plan.targets) {
      logInfo(`    USER#${t.userId} -> SESSION#${t.sessionId}`);
    }
  }
}

async function confirmProd(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(
      "Type 'BACKFILL PRODUCTION' to confirm: ",
      (answer: string) => {
        rl.close();
        resolve(answer === 'BACKFILL PRODUCTION');
      }
    );
  });
}

// ============================================================
// Main
// ============================================================

export async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error: unknown) {
    logError(error instanceof Error ? error.message : String(error));
    console.log('');
    console.log(HELP_TEXT);
    return 1;
  }

  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  logInfo(`Environment: ${options.env}`);
  logInfo(`Table: ${TABLE_NAME}  Region: ${REGION}`);
  logInfo(options.execute ? 'Mode: EXECUTE (writes enabled)' : 'Mode: DRY-RUN (no writes)');

  const doc = createDocClient();

  logInfo('Scanning table...');
  const data = await loadTable(doc);
  logInfo(
    `Loaded: ${data.sessions.length} sessions, ${data.participants.length} participants, ` +
      `${data.reviewAssignments.length} review assignments, ` +
      `${data.teamAssignments.length} team assignments, ${data.users.length} users`
  );

  const plan = selectBackfillTargets(data);
  printPlanSummary(plan);

  if (!options.execute) {
    logWarn('Dry-run only. Re-run with --execute to apply these changes.');
    return 0;
  }

  if (plan.targets.length === 0) {
    logSuccess('Nothing to backfill.');
    return 0;
  }

  if (options.env === 'prod') {
    logWarn('Production backfill requires explicit confirmation.');
    const confirmed = await confirmProd();
    if (!confirmed) {
      logInfo('Backfill cancelled.');
      return 0;
    }
  }

  let created = 0;
  for (const target of plan.targets) {
    await writeReviewAssignment(doc, target);
    created += 1;
    logInfo(`Created ReviewAssignment USER#${target.userId} -> SESSION#${target.sessionId}`);
  }

  logSuccess(`Backfill complete. Created ${created} ReviewAssignment(s).`);
  return 0;
}

// Run only when invoked directly (not when imported by tests).
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      logError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
