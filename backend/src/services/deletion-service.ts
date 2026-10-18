import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import { AppError, forbiddenError, notFoundError } from '../utils/error-handler.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import * as sessionRepository from '../repositories/session-repository.js';
import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import { recordAuditLog } from './audit-service.js';
import { canAccessMediaFile } from './access-control-service.js';
import type { AuthUser } from '../utils/auth-middleware.js';

// --- Constants ---

const ALLOWED_ROLES = ['ADMIN', 'TEAM_LEADER'] as const;

// --- Environment helpers ---

function getMediaBucketName(): string {
  return process.env.MEDIA_BUCKET_NAME ?? '';
}

function getDataBucketName(): string {
  return process.env.DATA_BUCKET_NAME ?? '';
}

// --- Interfaces ---

export interface DeleteMediaParams {
  mediaFileId: string;
  /**
   * The authenticated user performing the deletion.
   * Used for uploadedBy-based access control (ADMIN / TEAM_LEADER / REVIEWER).
   */
  user: AuthUser;
  /**
   * When the media file is linked to an IN_PROGRESS review session:
   * - REVIEWER: deletion is always rejected (403), regardless of this flag.
   * - ADMIN / TEAM_LEADER: deletion requires force=true. Without it, the service
   *   throws a CONFIRMATION_REQUIRED error (409) so the UI can show a warning.
   */
  force?: boolean;
}

/**
 * Error code used when an ADMIN/TEAM_LEADER attempts to delete a media file
 * that is linked to an IN_PROGRESS session without confirming (force).
 */
export const CONFIRMATION_REQUIRED_CODE = 'CONFIRMATION_REQUIRED';

export interface DeleteTranscriptionParams {
  sessionId: string;
  userId: string;
  userRole: string;
  userTeamId?: string;
}

// --- AWS Clients (lazy singletons) ---

let s3Client: S3Client | undefined;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

/** Allow overriding the S3 client for testing */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

// --- Pure Functions (exported for property testing) ---

/**
 * Check if a user role has access to deletion operations.
 * Returns true for ADMIN/TEAM_LEADER, false for REVIEWER.
 * Pure function — no side effects.
 */
export function checkRoleAccess(role: string): boolean {
  return (ALLOWED_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a user has team-based access to delete a resource.
 * - ADMIN can delete anything (returns true regardless of team)
 * - TEAM_LEADER can only delete resources belonging to their team
 * - Returns false if TeamLeader's team doesn't match resource team
 * Pure function — no side effects.
 */
export function checkTeamDeleteAccess(
  userRole: string,
  userTeamId: string | undefined,
  resourceTeamId: string | undefined,
): boolean {
  // Admin can delete anything
  if (userRole === 'ADMIN') {
    return true;
  }

  // TeamLeader must have a team assignment
  if (!userTeamId) {
    return false;
  }

  // If resource has no team, only Admin can delete
  if (!resourceTeamId) {
    return false;
  }

  // TeamLeader can only delete resources in their own team
  return userTeamId === resourceTeamId;
}

// --- Service Functions ---

/**
 * Delete a media file.
 * 1. Check role access (Admin/TeamLeader only)
 * 2. Get media file record
 * 3. Check team access
 * 4. Delete S3 object
 * 5. Delete DynamoDB metadata record
 * 5b. Cascade delete all transcription jobs for the media file + their S3 output
 * 6. Reconcile the linked session: PENDING -> delete, IN_PROGRESS -> COMPLETED (Req 6)
 * 7. Record AuditLog
 *
 * If a partial deletion failure occurs (some steps completed but not all),
 * records PARTIAL_DELETION_FAILURE in the audit log and re-throws the error.
 */
export async function deleteMediaFile(params: DeleteMediaParams): Promise<void> {
  const { mediaFileId, user, force } = params;
  const userId = user.userId;
  const userRole = user.role;

  // 1. Get media file record
  const mediaFile = await mediaFileRepository.getById(mediaFileId);
  if (!mediaFile) {
    throw notFoundError('指定されたメディアファイルが見つかりません。');
  }

  // 2. Check access based on the uploader (ADMIN / TEAM_LEADER / REVIEWER).
  // ADMIN: any file. TEAM_LEADER: files uploaded by team members. REVIEWER: own uploads.
  const hasAccess = await canAccessMediaFile(user, mediaFile.uploadedBy);
  if (!hasAccess) {
    // Return 404 to hide existence from unauthorized users
    throw notFoundError('指定されたメディアファイルが見つかりません。');
  }

  // 3. Guard against deleting media linked to an IN_PROGRESS review session.
  const linkedSession = mediaFile.sessionId
    ? await sessionRepository.getSessionById(mediaFile.sessionId)
    : null;

  if (linkedSession && linkedSession.status === 'IN_PROGRESS') {
    if (userRole === 'REVIEWER') {
      // Reviewers may never delete media that is under active review.
      throw forbiddenError(
        '進行中の校閲セッションに紐づくメディアファイルは削除できません。'
      );
    }

    // ADMIN / TEAM_LEADER must explicitly confirm (force) to proceed.
    if (!force) {
      throw new AppError({
        code: CONFIRMATION_REQUIRED_CODE,
        message:
          'このメディアファイルは進行中の校閲セッションに紐づいています。削除すると校閲中の音声・動画が再生できなくなります。削除を続行しますか？',
        statusCode: 409,
      });
    }
  }

  let s3Deleted = false;
  let metadataDeleted = false;

  try {
    // 4. Delete S3 object
    const mediaBucket = getMediaBucketName();
    if (mediaBucket && mediaFile.s3Key) {
      await getS3Client().send(
        new DeleteObjectCommand({
          Bucket: mediaBucket,
          Key: mediaFile.s3Key,
        }),
      );
    }
    s3Deleted = true;

    // 5. Delete DynamoDB metadata record
    await mediaFileRepository.deleteById(mediaFileId);
    metadataDeleted = true;

    // 5b. Cascade delete all transcription jobs for this media file, along with
    // their S3 output. This removes orphaned jobs (e.g. superseded jobs left
    // behind by re-transcription) so no job records point at a deleted media file.
    await deleteTranscriptionJobsForMedia(mediaFileId);

    // 6. Reconcile the linked ReviewSession (Requirement 6).
    // - PENDING (not started): delete the session (it can never be reviewed).
    // - IN_PROGRESS: mark it COMPLETED (preserve the review work done so far).
    // - COMPLETED: leave it as-is.
    if (linkedSession) {
      if (linkedSession.status === 'PENDING') {
        await cascadeDeleteSession(linkedSession.sessionId);
      } else if (linkedSession.status === 'IN_PROGRESS') {
        await sessionRepository.updateSessionStatus(linkedSession.sessionId, 'COMPLETED');
      }
    }
  } catch (error: unknown) {
    // If partial deletion occurred, record PARTIAL_DELETION_FAILURE
    if (s3Deleted || metadataDeleted) {
      await recordAuditLog({
        actorUserId: userId,
        actorRole: userRole as 'ADMIN' | 'TEAM_LEADER' | 'REVIEWER',
        operationType: 'PARTIAL_DELETION_FAILURE',
        resourceId: mediaFileId,
        resourceType: 'MediaFile',
        metadata: {
          resourceName: mediaFile.filename,
          reason: `Partial deletion failure: S3=${s3Deleted ? 'deleted' : 'pending'}, metadata=${metadataDeleted ? 'deleted' : 'pending'}. ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });
    }
    throw error;
  }

  // 7. Record AuditLog
  await recordAuditLog({
    actorUserId: userId,
    actorRole: userRole as 'ADMIN' | 'TEAM_LEADER' | 'REVIEWER',
    operationType: 'MEDIA_DELETED',
    resourceId: mediaFileId,
    resourceType: 'MediaFile',
    metadata: {
      filename: mediaFile.filename,
      s3Key: mediaFile.s3Key,
    },
  });
}

/**
 * Delete a transcription and its related data.
 * 1. Check role access (Admin/TeamLeader only)
 * 2. Get session record
 * 3. Check team access
 * 4. Delete S3 transcription output
 * 5. Cascade delete the session from DynamoDB (Session METADATA, Segment,
 *    Correction, ConsensusResult) — the session is always removed (Req 7 & 8).
 * 6. If the linked media file still exists (Req 8), reset its transcription job
 *    back to IN_PROGRESS so it can be re-transcribed. If the media file has
 *    already been deleted (Req 7), nothing else is needed.
 * 7. Record AuditLog
 *
 * If a partial deletion failure occurs (some records deleted but not all),
 * records PARTIAL_DELETION_FAILURE in the audit log and re-throws the error.
 */
export async function deleteTranscription(params: DeleteTranscriptionParams): Promise<void> {
  const { sessionId, userId, userRole, userTeamId } = params;

  // 1. Check role access
  if (!checkRoleAccess(userRole)) {
    throw forbiddenError('Transcription 削除機能へのアクセスが拒否されました。');
  }

  // 2. Get session record
  const session = await sessionRepository.getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定された ReviewSession が見つかりません。');
  }

  // Whether the linked media file still exists. When it does (Req 8), the
  // transcription job is reset to IN_PROGRESS after deletion so it can be re-run.
  const mediaFileStillExists = session.mediaFileDeleted !== true;

  // 3. Check team access - get session's team from DynamoDB item
  const sessionTeamId = await getSessionTeamId(sessionId);
  if (!checkTeamDeleteAccess(userRole, userTeamId, sessionTeamId)) {
    throw notFoundError('指定された ReviewSession が見つかりません。');
  }

  // Resolve the transcription job ID up front (used for both S3 cleanup and
  // resetting the job status). Reading it before the cascade delete avoids
  // losing the reference once the session METADATA is gone.
  const jobId = await getTranscriptionJobIdForSession(sessionId);

  let s3Deleted = false;
  let dynamoDeleted = false;

  try {
    // 4. Delete S3 transcription output
    const dataBucket = getDataBucketName();
    if (dataBucket && jobId) {
      await getS3Client().send(
        new DeleteObjectCommand({
          Bucket: dataBucket,
          Key: `transcriptions/${jobId}/output.json`,
        }),
      );
    }
    s3Deleted = true;

    // 5. Cascade delete the whole session (METADATA + transcription data).
    await cascadeDeleteSession(sessionId);
    dynamoDeleted = true;

    // 6. If the media file still exists, reset its transcription job so the
    // media can be re-transcribed (Req 8).
    if (mediaFileStillExists && jobId) {
      await transcriptionJobRepository.updateStatus(jobId, 'IN_PROGRESS');
    }
  } catch (error: unknown) {
    // If partial deletion occurred, record PARTIAL_DELETION_FAILURE
    if (s3Deleted || dynamoDeleted) {
      await recordAuditLog({
        actorUserId: userId,
        actorRole: userRole as 'ADMIN' | 'TEAM_LEADER' | 'REVIEWER',
        operationType: 'PARTIAL_DELETION_FAILURE',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: {
          resourceName: session.name,
          reason: `Partial deletion failure: S3=${s3Deleted ? 'deleted' : 'pending'}, DynamoDB=${dynamoDeleted ? 'deleted' : 'pending'}. ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });
    }
    throw error;
  }

  // 7. Record AuditLog
  await recordAuditLog({
    actorUserId: userId,
    actorRole: userRole as 'ADMIN' | 'TEAM_LEADER' | 'REVIEWER',
    operationType: 'TRANSCRIPTION_DELETED',
    resourceId: sessionId,
    resourceType: 'ReviewSession',
    metadata: {
      sessionName: session.name,
      jobReset: mediaFileStillExists && Boolean(jobId),
    },
  });
}

// --- Internal Helper Functions ---

/**
 * Get the team ID associated with a session from DynamoDB.
 */
async function getSessionTeamId(sessionId: string): Promise<string | undefined> {
  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      ProjectionExpression: 'GSI1PK',
    }),
  );

  if (!result.Item?.['GSI1PK']) {
    return undefined;
  }

  // GSI1PK format: TEAM#{teamId}
  const gsi1pk = result.Item['GSI1PK'] as string;
  if (gsi1pk.startsWith('TEAM#')) {
    return gsi1pk.substring(5);
  }
  return undefined;
}

/**
 * Get the transcription job ID associated with a session.
 */
async function getTranscriptionJobIdForSession(sessionId: string): Promise<string | undefined> {
  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      ProjectionExpression: 'transcriptionJobId',
    }),
  );

  return result.Item?.['transcriptionJobId'] as string | undefined;
}

/**
 * Delete all transcription jobs associated with a media file, together with
 * their S3 transcription output. Used when a media file is deleted so that no
 * job records (including superseded/orphaned ones) outlive the media file.
 *
 * This is the ONLY multi-object S3 cascade in this service, so it is the only
 * path that uses the all-settled pattern below. Rather than aborting on the
 * first failure (which would strand every remaining job's output.json in S3),
 * every job is attempted and failures are collected. Each job keeps the
 * per-job order (delete the S3 output first, THEN the DynamoDB job record); if
 * a job's S3 delete fails, its record delete is skipped and the job is counted
 * as failed. After all jobs settle, if any failed, a single aggregated error is
 * thrown so the caller's existing catch still records PARTIAL_DELETION_FAILURE
 * and re-throws.
 *
 * Idempotency: S3 DeleteObject on a missing key and the DynamoDB DeleteCommand
 * on an already-deleted key both succeed, so re-running deletion after a
 * partial failure is safe for already-deleted outputs and records.
 */
async function deleteTranscriptionJobsForMedia(mediaFileId: string): Promise<void> {
  const jobs = await transcriptionJobRepository.listByMediaFileId(mediaFileId);
  if (jobs.length === 0) {
    return;
  }

  const dataBucket = getDataBucketName();

  // Attempt every job's two-step deletion; collect failures instead of aborting.
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      // Delete the S3 transcription output for this job, if a data bucket is set.
      if (dataBucket) {
        const outputKey = job.outputS3Key ?? `transcriptions/${job.jobId}/output.json`;
        await getS3Client().send(
          new DeleteObjectCommand({
            Bucket: dataBucket,
            Key: outputKey,
          }),
        );
      }

      // Delete the job metadata record (only reached if the S3 delete succeeded).
      await transcriptionJobRepository.deleteById(job.jobId);
    }),
  );

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(
      `Failed to delete ${failures.length} of ${jobs.length} transcription job(s): ${messages.join('; ')}`,
    );
  }
}

/**
 * Cascade delete all records associated with a session.
 * Deletes: SESSION# METADATA, SEGMENT#*, CORRECTION#*, CONSENSUS#* records.
 */
async function cascadeDeleteSession(sessionId: string): Promise<void> {
  // Query all items with PK=SESSION#{sessionId}
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
      },
      ProjectionExpression: 'PK, SK',
    }),
  );

  const items = result.Items ?? [];

  if (items.length === 0) {
    return;
  }

  // BatchWrite has a limit of 25 items per request
  const batches: Array<{ PK: string; SK: string }[]> = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(
      items.slice(i, i + 25).map((item) => ({
        PK: item['PK'] as string,
        SK: item['SK'] as string,
      })),
    );
  }

  for (const batch of batches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((key) => ({
            DeleteRequest: {
              Key: { PK: key.PK, SK: key.SK },
            },
          })),
        },
      }),
    );
  }
}
