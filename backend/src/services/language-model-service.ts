import {
  TranscribeClient,
  CreateLanguageModelCommand,
  ListLanguageModelsCommand,
  DescribeLanguageModelCommand,
  DeleteLanguageModelCommand,
  ListTranscriptionJobsCommand,
  GetTranscriptionJobCommand,
  BaseModelName,
} from '@aws-sdk/client-transcribe';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  AppError,
  forbiddenError,
  validationError,
  notFoundError,
  quotaExceededError,
} from '../utils/error-handler.js';
import {
  requireRole,
  isAdmin,
  denyResourceAccess,
  type AuthUser,
} from '../utils/auth-middleware.js';
import { getTeamById } from '../repositories/team-repository.js';
import {
  checkSessionAccess,
  checkLanguageModelAccess,
  isTeamMember,
  getUserTeamIds,
} from './access-control-service.js';
import {
  putModel,
  getModel,
  findByDisplayName,
  updateDisplayName,
  updateTeamId,
  setDeletionStatus,
  hardDelete,
  queryByTeam,
  queryAll,
} from '../repositories/language-model-repository.js';
import type { LanguageModelMetadata } from '../types/index.js';
import { recordAuditLog } from './audit-service.js';

// --- Constants ---

const ALLOWED_ROLES = ['ADMIN', 'TEAM_LEADER'] as const;
const LANGUAGE_CODE = 'ja-JP';
const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 100;

/** Bounded retry/backoff for each idempotent deletion step. */
const DELETE_MAX_ATTEMPTS = 3;
const DELETE_BASE_BACKOFF_MS = 50;

// --- Environment helpers ---

function getDataBucketName(): string {
  return process.env.DATA_BUCKET_NAME ?? '';
}

function getDataAccessRoleArn(): string {
  return process.env.TRANSCRIBE_DATA_ACCESS_ROLE_ARN ?? '';
}

// --- Interfaces ---

export interface CreateModelParams {
  modelName: string;
  baseModelName: 'NarrowBand' | 'WideBand';
  displayName: string;
  teamId: string;
  segments: ConfirmedSegment[];
  sessionIds: string[];
  user: AuthUser;
}

export interface ConfirmedSegment {
  text: string;
  confirmed: boolean;
}

export interface LanguageModelRecord {
  modelName: string;
  baseModelName: string;
  displayName: string;
  teamId: string;
  status: string;
  trainingDataS3Uri: string;
  createdBy: string;
  createdAt: string;
}

export interface LanguageModelSummary {
  modelName: string;
  modelStatus: string;
  displayName?: string;
  teamId?: string;
  baseModelName?: string;
  createTime?: string;
}

export interface LanguageModelStatus {
  modelName: string;
  modelStatus: string;
  baseModelName?: string;
  failureReason?: string;
}

export interface ChangeModelTeamResult extends LanguageModelMetadata {
  oldTeamId: string;
  newTeamId: string;
}

// --- AWS Clients (lazy singletons) ---

let transcribeClient: TranscribeClient | undefined;
let s3Client: S3Client | undefined;

function getTranscribeClient(): TranscribeClient {
  if (!transcribeClient) {
    transcribeClient = new TranscribeClient({});
  }
  return transcribeClient;
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

/** Allow overriding the Transcribe client for testing */
export function setTranscribeClient(client: TranscribeClient): void {
  transcribeClient = client;
}

/** Allow overriding the S3 client for testing */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

// Backoff base is overridable so tests do not incur real delays.
let deleteBackoffBaseMs = DELETE_BASE_BACKOFF_MS;

/** Allow overriding (e.g. zeroing) the delete retry backoff base for testing. */
export function setDeleteBackoffBaseMs(ms: number): void {
  deleteBackoffBaseMs = ms;
}

// --- Pure Functions (exported for property testing) ---

/**
 * Check if a user role has access to language model operations.
 * Returns true for ADMIN/TEAM_LEADER, false for REVIEWER.
 * Pure function — no side effects.
 */
export function checkRoleAccess(role: string): boolean {
  return (ALLOWED_ROLES as readonly string[]).includes(role);
}

/**
 * Filter language models to only include COMPLETED status.
 * Pure function — no side effects.
 */
export function filterCompletedModels(models: LanguageModelSummary[]): LanguageModelSummary[] {
  return models.filter((model) => model.modelStatus === 'COMPLETED');
}

/**
 * Generate training data from confirmed segments.
 * Takes segments and returns only confirmed segment texts joined by newlines.
 * Pure function — no side effects.
 */
export function generateTrainingData(segments: ConfirmedSegment[]): string {
  return segments
    .filter((segment) => segment.confirmed)
    .map((segment) => segment.text)
    .join('\n');
}

// --- Service Functions ---

/**
 * Determine whether a thrown error represents a Transcribe quota / limit-exceeded
 * condition when creating a language model.
 *
 * Covers the SDK LimitExceededException (error.name) as well as HTTP 429
 * surfaced via $metadata.httpStatusCode or a numeric statusCode.
 * Pure function — no side effects.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
    httpStatusCode?: number;
    statusCode?: number;
  };

  if (
    err.name === 'LimitExceededException' ||
    err.name === 'ThrottlingException' ||
    err.name === 'TooManyRequestsException'
  ) {
    return true;
  }

  const httpStatus =
    err.$metadata?.httpStatusCode ?? err.httpStatusCode ?? err.statusCode;
  return httpStatus === 429;
}

/**
 * Determine whether a thrown error represents a "resource already absent"
 * condition (NotFound / 404). Both the Transcribe DeleteLanguageModel and the
 * S3 DeleteObject steps treat an already-absent resource as success so that a
 * re-invoked deletion is idempotent.
 * Pure function — no side effects.
 */
export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
    httpStatusCode?: number;
    statusCode?: number;
  };

  if (
    err.name === 'NotFoundException' ||
    err.name === 'BadRequestException' ||
    err.name === 'ResourceNotFoundException' ||
    err.name === 'NoSuchKey' ||
    err.Code === 'NoSuchKey' ||
    err.code === 'NoSuchKey'
  ) {
    return true;
  }

  const httpStatus =
    err.$metadata?.httpStatusCode ?? err.httpStatusCode ?? err.statusCode;
  return httpStatus === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an idempotent deletion step with bounded retry and exponential backoff.
 * The final failure is rethrown so the caller leaves the record PENDING and a
 * re-invoked DELETE can resume from the remaining steps.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DELETE_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < DELETE_MAX_ATTEMPTS) {
        await sleep(deleteBackoffBaseMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

/**
 * Check if a model name already exists in the list of language models.
 * Returns true if duplicate found.
 */
export async function checkModelNameDuplicate(modelName: string): Promise<boolean> {
  const client = getTranscribeClient();

  const response = await client.send(new ListLanguageModelsCommand({}));

  const models = response.Models ?? [];
  return models.some((model) => model.ModelName === modelName);
}

/**
 * Create a custom language model.
 * - Require TEAM_LEADER or above
 * - Validate the target teamId exists; non-ADMIN callers must be a member of it
 * - Verify the caller can access every source session (team isolation)
 * - Validate the displayName (trim, 1-100) and enforce within-team uniqueness
 * - Generate training data from confirmed segments
 * - Upload training data to S3
 * - Call Transcribe CreateLanguageModel API (quota/LimitExceeded -> QUOTA_EXCEEDED 429)
 * - Persist team-scoped metadata (deletionStatus ACTIVE)
 * - Record LANGUAGE_MODEL_CREATED audit log (incl. teamId + displayName)
 */
export async function createModel(params: CreateModelParams): Promise<LanguageModelRecord> {
  const { modelName, baseModelName, segments, sessionIds, teamId, user } = params;

  // Require TEAM_LEADER or above (throws 403 otherwise)
  requireRole(user, 'TEAM_LEADER');

  // Validate the target team exists
  const team = await getTeamById(teamId);
  if (!team) {
    throw validationError(
      '指定されたチームが存在しません。',
      `Team not found: ${teamId}`,
    );
  }

  // Non-ADMIN callers must be a member of the target team
  if (!isAdmin(user)) {
    const member = await isTeamMember(user.userId, teamId);
    if (!member) {
      throw forbiddenError(
        '指定されたチームのメンバーではありません。',
        `User ${user.userId} is not a member of team ${teamId}`,
      );
    }
  }

  // Verify the caller can access every source session (other-team session -> 404)
  for (const sessionId of sessionIds) {
    await checkSessionAccess(user, sessionId);
  }

  // Validate displayName (trim, 1-100 chars)
  const displayName = params.displayName.trim();
  if (displayName.length < DISPLAY_NAME_MIN || displayName.length > DISPLAY_NAME_MAX) {
    throw validationError(
      `表示名は${DISPLAY_NAME_MIN}文字以上${DISPLAY_NAME_MAX}文字以下で指定してください。`,
    );
  }

  // Enforce within-team displayName uniqueness
  const displayNameLower = displayName.toLowerCase();
  const existingByDisplayName = await findByDisplayName(teamId, displayNameLower);
  if (existingByDisplayName) {
    throw validationError(
      'チーム内に同じ表示名のモデルが既に存在します。別の表示名を指定してください。',
      `Display name "${displayName}" already exists in team ${teamId}`,
    );
  }

  // Check model name duplicate
  const isDuplicate = await checkModelNameDuplicate(modelName);
  if (isDuplicate) {
    throw validationError(
      'モデル名が重複しています。別のモデル名を指定してください。',
      `Model name "${modelName}" already exists`,
    );
  }

  // Generate training data
  const trainingData = generateTrainingData(segments);
  if (!trainingData) {
    throw validationError('確定済みの Segment がありません。トレーニングデータを生成できません。');
  }

  // Upload training data to S3
  const dataBucket = getDataBucketName();
  if (!dataBucket) {
    throw new AppError({
      code: 'CONFIGURATION_ERROR',
      message: 'データバケットの設定が不足しています。',
      statusCode: 500,
      details: 'DATA_BUCKET_NAME environment variable is not set',
    });
  }

  const dataAccessRoleArn = getDataAccessRoleArn();
  if (!dataAccessRoleArn) {
    throw new AppError({
      code: 'CONFIGURATION_ERROR',
      message: 'Transcribe データアクセスロールの設定が不足しています。',
      statusCode: 500,
      details: 'TRANSCRIBE_DATA_ACCESS_ROLE_ARN environment variable is not set',
    });
  }

  const trainingDataKey = `training-data/${modelName}/training.txt`;
  const trainingDataS3Uri = `s3://${dataBucket}/${trainingDataKey}`;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: trainingDataKey,
      Body: trainingData,
      ContentType: 'text/plain',
    }),
  );

  // Call Transcribe CreateLanguageModel API.
  // A quota / LimitExceeded condition surfaces as a dedicated QUOTA_EXCEEDED (429).
  try {
    await getTranscribeClient().send(
      new CreateLanguageModelCommand({
        ModelName: modelName,
        BaseModelName: baseModelName as BaseModelName,
        InputDataConfig: {
          S3Uri: trainingDataS3Uri,
          DataAccessRoleArn: dataAccessRoleArn,
        },
        LanguageCode: LANGUAGE_CODE,
      }),
    );
  } catch (error: unknown) {
    if (isQuotaExceededError(error)) {
      throw quotaExceededError(
        'カスタム言語モデルの作成上限に達しています。既存のモデルを削除するか、上限緩和を申請してください。',
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }

  const now = new Date().toISOString();

  // Persist team-scoped metadata (two-layer: Transcribe model + DynamoDB metadata)
  await putModel({
    modelName,
    teamId,
    displayName,
    displayNameLower,
    baseModelName,
    createdBy: user.userId,
    createdAt: now,
    sessionIds,
    s3Key: trainingDataKey,
    deletionStatus: 'ACTIVE',
  });

  // Record AuditLog (LANGUAGE_MODEL_CREATED)
  await recordAuditLog({
    actorUserId: user.userId,
    actorRole: user.role,
    operationType: 'LANGUAGE_MODEL_CREATED',
    resourceId: modelName,
    resourceType: 'LanguageModel',
    metadata: {
      baseModelName,
      teamId,
      displayName,
      sessionIds: sessionIds.join(','),
    },
  });

  return {
    modelName,
    baseModelName,
    displayName,
    teamId,
    status: 'IN_PROGRESS',
    trainingDataS3Uri,
    createdBy: user.userId,
    createdAt: now,
  };
}

/**
 * Rename the human-readable display name of a custom language model.
 *
 * Mirrors the session-name edit flow (session-service.renameSession):
 * - Verify the caller can access the model (team isolation; other-team / missing
 *   / soft-deleted -> 404 via checkLanguageModelAccess).
 * - Require TEAM_LEADER or above (REVIEWER is rejected with 403).
 * - Trim the raw name and enforce a 1-100 character length constraint.
 * - Enforce within-team displayName uniqueness (case-insensitive), excluding the
 *   model itself so renaming to its current name is allowed.
 * - Persist the new displayName/displayNameLower (and dependent GSI2SK).
 *
 * @returns the updated LanguageModelMetadata record
 * @throws notFoundError (404) when the model is inaccessible / missing / PENDING
 * @throws forbiddenError (403) when the caller is below TEAM_LEADER
 * @throws validationError (400) when the trimmed name is out of range or
 *   duplicates another model's displayName in the same team
 */
export async function renameModelDisplayName(
  user: AuthUser,
  modelName: string,
  rawName: string
): Promise<LanguageModelMetadata> {
  // Access check (team isolation): 404 when the model is not visible to the caller.
  const model = await checkLanguageModelAccess(user, modelName);

  // Only TEAM_LEADER or above may rename (REVIEWER -> 403).
  requireRole(user, 'TEAM_LEADER');

  // Trim + validate the display name (reuse the session-name rule style/messages).
  const displayName = rawName.trim();
  if (displayName.length === 0) {
    throw validationError('Display name is required.');
  }
  if (displayName.length < DISPLAY_NAME_MIN || displayName.length > DISPLAY_NAME_MAX) {
    throw validationError('Display name must be between 1 and 100 characters.');
  }

  // Enforce within-team displayName uniqueness, excluding the model itself.
  const displayNameLower = displayName.toLowerCase();
  const existing = await findByDisplayName(model.teamId, displayNameLower);
  if (existing && existing.modelName !== model.modelName) {
    throw validationError(
      'チーム内に同じ表示名のモデルが既に存在します。別の表示名を指定してください。',
      `Display name "${displayName}" already exists in team ${model.teamId}`,
    );
  }

  await updateDisplayName(modelName, displayName, displayNameLower);

  return {
    ...model,
    displayName,
    displayNameLower,
  };
}

/**
 * Re-assign a custom language model to a different team (ADMIN only).
 *
 * Supports future team reorganizations. Because a model belongs to exactly one
 * team, changing the teamId makes the model invisible to the original team and
 * visible to the destination team (the accepted "1 model = 1 team" constraint).
 *
 * Flow:
 * - Require ADMIN (TEAM_LEADER / REVIEWER are rejected with 403).
 * - Load the metadata record (404 when missing).
 * - Validate that the destination team actually exists (400 otherwise), so a
 *   model can never be re-assigned to a non-existent team.
 * - Reject when the destination team already contains a model with the same
 *   displayName (case-insensitive, within-team uniqueness), prompting ADMIN to
 *   rename before moving.
 * - Rewrite teamId and the dependent GSI1PK/GSI2PK keys.
 *
 * @returns the previous teamId, the new teamId, and the updated metadata
 * @throws forbiddenError (403) when the caller is not an ADMIN
 * @throws notFoundError (404) when the model metadata does not exist
 * @throws validationError (400) when the destination team does not exist or a
 *   displayName collision prevents the move
 */
export async function changeModelTeam(
  user: AuthUser,
  modelName: string,
  newTeamId: string
): Promise<ChangeModelTeamResult> {
  // Only ADMIN may re-assign a model's team.
  requireRole(user, 'ADMIN');

  // Load the metadata record (404 when missing).
  const model = await getModel(modelName);
  if (!model) {
    throw notFoundError(
      'リソースが見つかりません。',
      `Language model not found: ${modelName}`,
    );
  }

  const oldTeamId = model.teamId;

  // Validate that the destination team exists (no re-assignment to a ghost team).
  const team = await getTeamById(newTeamId);
  if (!team) {
    throw validationError(
      '指定されたチームが存在しません。',
      `Team not found: ${newTeamId}`,
    );
  }

  // Reject when the destination team already has a model with the same
  // displayName (within-team uniqueness). Prompt ADMIN to rename first.
  const collision = await findByDisplayName(newTeamId, model.displayNameLower);
  if (collision && collision.modelName !== model.modelName) {
    throw validationError(
      '移動先のチームに同じ表示名のモデルが既に存在します。先に表示名を変更してください。',
      `Display name "${model.displayName}" already exists in team ${newTeamId}`,
    );
  }

  // Rewrite teamId and the dependent GSI1PK/GSI2PK keys.
  await updateTeamId(modelName, newTeamId);

  return {
    oldTeamId,
    newTeamId,
    ...model,
    teamId: newTeamId,
  };
}

/**
 * Determine whether the caller may delete the given model, returning its
 * metadata when access is granted.
 *
 * Unlike checkLanguageModelAccess (which hides PENDING records as 404 for the
 * list/rename flows), delete must be able to RESUME a soft-deleted (PENDING)
 * record so a re-invoked DELETE converges. Therefore this check loads the model
 * directly and treats a PENDING record as still visible to its team:
 * - Missing metadata -> notFoundError (404) only on the FIRST invocation; the
 *   caller handles an already hard-deleted record as idempotent success before
 *   calling this (see deleteModel).
 * - ADMIN can delete any team's model.
 * - Others must have model.teamId among their teams, else 404 (hide existence).
 */
async function requireDeletableModel(
  user: AuthUser,
  modelName: string
): Promise<LanguageModelMetadata> {
  const model = await getModel(modelName);
  if (!model) {
    denyResourceAccess();
  }

  if (isAdmin(user)) {
    return model;
  }

  const teamIds = await getUserTeamIds(user.userId);
  if (!teamIds.includes(model.teamId)) {
    denyResourceAccess();
  }

  return model;
}

/**
 * Determine whether a model is referenced by any IN_PROGRESS transcription job.
 *
 * Authoritative in-use source (NO DynamoDB check): Transcribe
 * ListTranscriptionJobs(Status='IN_PROGRESS'), paginated via NextToken. A job
 * summary may omit the model name; in that case GetTranscriptionJob is used as a
 * fallback to read the model name from the job settings.
 */
async function isModelInUseByInProgressJob(modelName: string): Promise<boolean> {
  const client = getTranscribeClient();
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListTranscriptionJobsCommand({
        Status: 'IN_PROGRESS',
        NextToken: nextToken,
      })
    );

    const summaries = response.TranscriptionJobSummaries ?? [];
    for (const summary of summaries) {
      const summaryModel = summary.ModelSettings?.LanguageModelName;
      if (summaryModel) {
        if (summaryModel === modelName) {
          return true;
        }
        // Summary carried a (different) model name — no fallback needed.
        continue;
      }

      // Summary lacks the model name: fall back to GetTranscriptionJob.
      const jobName = summary.TranscriptionJobName;
      if (!jobName) {
        continue;
      }
      const jobResponse = await client.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
      );
      const job = jobResponse.TranscriptionJob;
      const jobModel = job?.ModelSettings?.LanguageModelName;
      if (jobModel === modelName) {
        return true;
      }
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return false;
}

/**
 * Delete a custom language model (two-layer teardown).
 *
 * Authorization: the caller must be able to access the model (team isolation)
 * and be TEAM_LEADER or above (REVIEWER -> 403). ADMIN may delete any team's
 * model; a TEAM_LEADER may delete only their own team's models.
 *
 * Eligibility (authoritative, NO DynamoDB in-use check):
 * - Reject (validationError) when the model is still training: Transcribe
 *   DescribeLanguageModel reports ModelStatus 'IN_PROGRESS'.
 * - Reject (validationError) when any IN_PROGRESS transcription job references
 *   the model (ListTranscriptionJobs + GetTranscriptionJob fallback).
 * Completed jobs that reference the model do NOT block deletion.
 *
 * Deletion order (each step idempotent, bounded retry/backoff):
 *   (1) soft-delete: setDeletionStatus(modelName, 'PENDING')
 *   (2) Transcribe DeleteLanguageModel (already-absent / NotFound = success)
 *   (3) S3 DeleteObject on training-data/{modelName}/training.txt (absent = success)
 *   (4) hard-delete: remove the DynamoDB metadata record
 *
 * Re-runnable recovery: on a later-step failure the record is LEFT PENDING and
 * the error is rethrown, so re-invoking the same DELETE resumes from the
 * remaining steps. Re-invocation on a PENDING record skips straight to the
 * Transcribe/S3/hard-delete steps (step 1 is a no-op since it is idempotent).
 *
 * On success a LANGUAGE_MODEL_DELETED audit log is recorded.
 *
 * @throws forbiddenError (403) when the caller is below TEAM_LEADER
 * @throws notFoundError (404) when the model is not visible to the caller
 * @throws validationError (400) when the model is training or in use
 */
export async function deleteModel(user: AuthUser, modelName: string): Promise<void> {
  // Ownership / team isolation (PENDING records remain resumable).
  const model = await requireDeletableModel(user, modelName);

  // Only TEAM_LEADER or above may delete (REVIEWER -> 403).
  requireRole(user, 'TEAM_LEADER');

  // Eligibility is only enforced on the FIRST pass (ACTIVE). A record already in
  // PENDING is mid-teardown; re-invocation resumes the remaining steps and must
  // not re-run the in-use/training gates (the model may already be gone).
  if (model.deletionStatus !== 'PENDING') {
    // Reject when the model is still training.
    let describeStatus: string | undefined;
    try {
      const described = await getTranscribeClient().send(
        new DescribeLanguageModelCommand({ ModelName: modelName })
      );
      describeStatus = described.LanguageModel?.ModelStatus;
    } catch (error: unknown) {
      // If the Transcribe model is already absent, training cannot be in
      // progress; continue (the delete is effectively a cleanup).
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    if (describeStatus === 'IN_PROGRESS') {
      throw validationError(
        'モデルの学習が進行中のため削除できません。学習の完了後に再度お試しください。',
        `Model ${modelName} is still training (IN_PROGRESS)`,
      );
    }

    // Reject when an in-progress job references the model.
    const inUse = await isModelInUseByInProgressJob(modelName);
    if (inUse) {
      throw validationError(
        '実行中の文字起こしジョブがこのモデルを使用しているため削除できません。ジョブの完了後に再度お試しください。',
        `Model ${modelName} is referenced by an in-progress transcription job`,
      );
    }
  }

  // (1) Soft-delete: mark PENDING (idempotent).
  await withRetry(() => setDeletionStatus(modelName, 'PENDING'));

  // (2) Transcribe DeleteLanguageModel (already-absent = success).
  await withRetry(async () => {
    try {
      await getTranscribeClient().send(
        new DeleteLanguageModelCommand({ ModelName: modelName })
      );
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  });

  // (3) S3 DeleteObject on the training data (already-absent = success).
  const dataBucket = getDataBucketName();
  const trainingDataKey = model.s3Key || `training-data/${modelName}/training.txt`;
  if (dataBucket) {
    await withRetry(async () => {
      try {
        await getS3Client().send(
          new DeleteObjectCommand({
            Bucket: dataBucket,
            Key: trainingDataKey,
          })
        );
      } catch (error: unknown) {
        if (isNotFoundError(error)) {
          return;
        }
        throw error;
      }
    });
  }

  // (4) Hard-delete the DynamoDB metadata record.
  await withRetry(() => hardDelete(modelName));

  // Record AuditLog (LANGUAGE_MODEL_DELETED) after a successful teardown.
  await recordAuditLog({
    actorUserId: user.userId,
    actorRole: user.role,
    operationType: 'LANGUAGE_MODEL_DELETED',
    resourceId: modelName,
    resourceType: 'LanguageModel',
    metadata: {
      teamId: model.teamId,
      displayName: model.displayName,
    },
  });
}

/**
 * List language models visible to the caller.
 *
 * Team isolation (Requirement 18.4):
 * - ADMIN sees every team-scoped metadata record (GSI3 queryAll).
 * - Others see the union of their teams' metadata (GSI1 queryByTeam over
 *   getUserTeamIds).
 * - Soft-deleted (deletionStatus 'PENDING') metadata is excluded.
 *
 * The visible set is then intersected with Amazon Transcribe's actual models
 * (ListLanguageModels), keeping only entries that are COMPLETED in Transcribe.
 * A model is returned only when it is present in BOTH the metadata set and the
 * Transcribe COMPLETED set (matched by modelName).
 */
export async function listModels(user: AuthUser): Promise<LanguageModelSummary[]> {
  // 1) Team-scoped metadata set (excluding PENDING).
  const metadata = await loadVisibleMetadata(user);
  const activeMetadata = metadata.filter((m) => m.deletionStatus !== 'PENDING');

  // De-duplicate by modelName (a user in multiple teams could never see the
  // same model twice because a model belongs to a single team, but ADMIN's
  // queryAll and the union stay robust regardless).
  const metadataByName = new Map<string, LanguageModelMetadata>();
  for (const m of activeMetadata) {
    metadataByName.set(m.modelName, m);
  }

  // 2) Transcribe models, kept only when COMPLETED.
  const client = getTranscribeClient();
  const response = await client.send(new ListLanguageModelsCommand({}));
  const completedTranscribe = filterCompletedModels(
    (response.Models ?? []).map((model) => ({
      modelName: model.ModelName ?? '',
      modelStatus: model.ModelStatus ?? '',
      baseModelName: model.BaseModelName,
      createTime: model.CreateTime?.toISOString(),
    }))
  );

  // 3) Intersection: only models present in BOTH sets.
  const result: LanguageModelSummary[] = [];
  for (const transcribeModel of completedTranscribe) {
    const meta = metadataByName.get(transcribeModel.modelName);
    if (!meta) {
      continue;
    }
    result.push({
      modelName: transcribeModel.modelName,
      modelStatus: transcribeModel.modelStatus,
      displayName: meta.displayName,
      teamId: meta.teamId,
      baseModelName: transcribeModel.baseModelName ?? meta.baseModelName,
      createTime: transcribeModel.createTime,
    });
  }

  return result;
}

/**
 * Load the language model metadata records visible to a user.
 * ADMIN -> all records (GSI3). Others -> union over their teams (GSI1).
 */
async function loadVisibleMetadata(
  user: AuthUser
): Promise<LanguageModelMetadata[]> {
  if (isAdmin(user)) {
    return queryAll();
  }

  const teamIds = await getUserTeamIds(user.userId);
  const perTeam = await Promise.all(teamIds.map((teamId) => queryByTeam(teamId)));
  return perTeam.flat();
}

/**
 * Get the status of a specific language model.
 */
export async function getModelStatus(modelName: string): Promise<LanguageModelStatus> {
  const client = getTranscribeClient();

  const response = await client.send(
    new DescribeLanguageModelCommand({ ModelName: modelName }),
  );

  const model = response.LanguageModel;
  if (!model) {
    throw new AppError({
      code: 'NOT_FOUND',
      message: '指定されたカスタム言語モデルが見つかりません。',
      statusCode: 404,
    });
  }

  return {
    modelName: model.ModelName ?? modelName,
    modelStatus: model.ModelStatus ?? 'UNKNOWN',
    baseModelName: model.BaseModelName,
    failureReason: model.FailureReason,
  };
}
