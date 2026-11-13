import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * DynamoDB helpers for provisioning the reusable fixed E2E users directly,
 * mirroring the backend user-repository single-table layout:
 *   PK: USER#{userId}, SK: METADATA
 *   GSI1PK: EMAIL#{email}, GSI1SK: USER#{userId}
 *   entityType: 'User', userId, email, displayName, role, isActive
 *
 * Writing the record directly (no API, no Cognito email) keeps `extractUser`'s
 * email-based resolution consistent and role correct, without consuming the
 * Cognito email quota.
 */

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'TranscriptionReviewApp';
const REGION = process.env.AWS_REGION || 'ap-northeast-1';

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

/** Look up a user record by email via GSI1. Returns its userId, or null. */
export async function getUserIdByEmail(email: string): Promise<string | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `EMAIL#${email}`,
        ':prefix': 'USER#',
      },
      Limit: 1,
    })
  );
  const item = res.Items?.[0] as { userId?: string } | undefined;
  return item?.userId ?? null;
}

/**
 * Ensure a DynamoDB user record exists for the given email. If one already
 * exists, its userId is returned unchanged. Otherwise a new record is written
 * with the given userId/role (isActive: true).
 */
export async function ensureUserRecord(params: {
  userId: string;
  email: string;
  displayName: string;
  role: 'TEAM_LEADER' | 'REVIEWER' | 'ADMIN';
}): Promise<string> {
  const existing = await getUserIdByEmail(params.email);
  if (existing) return existing;

  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${params.userId}`,
        SK: 'METADATA',
        GSI1PK: `EMAIL#${params.email}`,
        GSI1SK: `USER#${params.userId}`,
        entityType: 'User',
        userId: params.userId,
        email: params.email,
        displayName: params.displayName,
        role: params.role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );
  return params.userId;
}

// ============================================================
// Upload-origin session seeding (reviewer-uploaded-session-visibility spec)
// ============================================================

/**
 * Seed an "upload-origin" ReviewSession the way the FIXED backend produces it,
 * so E2E can verify the post-fix full flow against a deployed environment.
 *
 * This mirrors the write layout of the production repositories:
 *   - ReviewSession:      PK=SESSION#{sessionId}, SK=METADATA (session-repository.createSession)
 *   - SessionParticipant: PK=SESSION#{sessionId}, SK=PARTICIPANT#{uploaderId},
 *                         GSI2PK=USER#{uploaderId} (uploader → appears in "my tasks")
 *   - ReviewAssignment:   PK=USER#{uploaderId}, SK=ASSIGNMENT#{sessionId},
 *                         GSI1PK=SESSION#{sessionId} (the fix — makes it appear in GET /sessions
 *                         via getAccessibleSessionIds' direct-assignment path; team-repository.createReviewAssignment)
 *
 * The ReviewAssignment is exactly what task 5.1 / the backfill (task 8) create.
 * Seeding it here lets the visibility assertions pass on a correctly-fixed +
 * backfilled environment (and fail loudly if the fix/backfill regressed).
 *
 * Idempotent: fixed-key PUTs, safe to re-run.
 */
export async function seedUploadOriginSession(params: {
  sessionId: string;
  transcriptionJobId: string;
  name: string;
  uploaderId: string;
  /** Uploader's team. Set for the TeamLeader scenario; omit for the Reviewer (no-team) scenario. */
  teamId?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}): Promise<void> {
  const now = new Date().toISOString();
  const status = params.status ?? 'COMPLETED';

  // 1. ReviewSession metadata (GSI1 TEAM# only when teamId is set — matches createSession).
  const sessionItem: Record<string, unknown> = {
    PK: `SESSION#${params.sessionId}`,
    SK: 'METADATA',
    entityType: 'ReviewSession',
    sessionId: params.sessionId,
    transcriptionJobId: params.transcriptionJobId,
    name: params.name,
    status,
    assignedReviewerCount: 1,
    consensusThreshold: 67,
    createdAt: now,
    updatedAt: now,
  };
  if (params.teamId) {
    sessionItem['assignedTeamId'] = params.teamId;
    sessionItem['GSI1PK'] = `TEAM#${params.teamId}`;
    sessionItem['GSI1SK'] = `SESSION#${now}#${params.sessionId}`;
  }
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: sessionItem }));

  // 2. SessionParticipant — uploader (visible via GET /sessions/assigned).
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `SESSION#${params.sessionId}`,
        SK: `PARTICIPANT#${params.uploaderId}`,
        GSI2PK: `USER#${params.uploaderId}`,
        GSI2SK: `PARTICIPANT#${now}#${params.sessionId}`,
        entityType: 'SessionParticipant',
        sessionId: params.sessionId,
        userId: params.uploaderId,
        joinedAt: now,
      },
    })
  );

  // 3. ReviewAssignment — the fix / backfill output (visible via GET /sessions).
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${params.uploaderId}`,
        SK: `ASSIGNMENT#${params.sessionId}`,
        GSI1PK: `SESSION#${params.sessionId}`,
        GSI1SK: `USER#${params.uploaderId}`,
        entityType: 'ReviewAssignment',
        userId: params.uploaderId,
        sessionId: params.sessionId,
        createdBy: params.uploaderId,
        createdAt: now,
      },
    })
  );
}

/**
 * Point an existing seeded MediaFile at a session by writing the `sessionId`
 * link (and keeping scanStatus=CLEAN), so `getMediaFileForSession` →
 * `getBySessionId` resolves it and returns a signed URL. Mirrors the shape
 * written by seed/seed-media-files.ts but only for the fields media resolution
 * and the scan-status gate depend on.
 *
 * Used to make an upload-origin session's media resolvable for the review-page
 * assertions. Requires the S3 object for `mediaFileId` to already exist (seeded
 * via `npm run seed:media`) for the CloudFront signed-URL fetch to succeed.
 */
export async function linkMediaFileToSession(params: {
  mediaFileId: string;
  sessionId: string;
  filename: string;
  s3Bucket: string;
  contentType: string;
  uploaderId: string;
  teamId?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `MEDIA#${params.mediaFileId}`,
        SK: 'METADATA',
        entityType: 'MediaFile',
        mediaFileId: params.mediaFileId,
        filename: params.filename,
        s3Key: `media/${params.mediaFileId}/${params.filename}`,
        s3Bucket: params.s3Bucket,
        contentType: params.contentType,
        fileSize: 48000,
        uploadedBy: params.uploaderId,
        teamId: params.teamId,
        status: 'COMPLETED',
        scanStatus: 'CLEAN',
        sessionId: params.sessionId,
        createdAt: now,
        updatedAt: now,
        uploadedAt: now,
        GSI1PK: params.teamId ? `TEAM#${params.teamId}` : undefined,
        GSI1SK: params.teamId ? `MEDIA#${now}#${params.mediaFileId}` : undefined,
        GSI2PK: `USER#${params.uploaderId}`,
        GSI2SK: `MEDIA#${now}#${params.mediaFileId}`,
      },
    })
  );
}

/**
 * Resolve the media S3 bucket name from the environment (MEDIA_BUCKET_NAME),
 * the same variable seed/seed-media-files.ts uses. Returns null when unset so
 * callers can skip media-dependent setup gracefully instead of writing a
 * MediaFile record that points at a non-existent bucket.
 */
export function getMediaBucketName(): string | null {
  return process.env.MEDIA_BUCKET_NAME ?? null;
}
