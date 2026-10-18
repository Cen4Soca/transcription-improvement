import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { v4 as uuidv4 } from 'uuid';
import { TranscriptionJob, TranscriptionJobStatus } from '../types/transcription-job.js';
import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import { AppError, notFoundError, validationError } from '../utils/error-handler.js';
import { createSessionForJob } from './session-service.js';
import { isAdmin, type AuthUser } from '../utils/auth-middleware.js';
import {
  checkLanguageModelAccess,
  getUserTeamIds,
} from './access-control-service.js';
import { recordAuditLog } from './audit-service.js';

// --- Environment helpers ---

function getMediaBucketName(): string {
  return process.env.MEDIA_BUCKET_NAME ?? '';
}

function getDataBucketName(): string {
  return process.env.DATA_BUCKET_NAME ?? '';
}

const DEFAULT_MAX_SPEAKER_LABELS = 2;
const DEFAULT_LANGUAGE_CODE = 'ja-JP';

// --- Interfaces ---

export interface StartJobParams {
  mediaFileId: string;
  maxSpeakerLabels?: number;  // default: 2, range: 2-10
  languageCode?: string;       // default: 'ja-JP'
  languageModelName?: string;  // optional custom language model
  user: AuthUser;
}

// --- Transcribe Client (lazy singleton) ---

let transcribeClient: TranscribeClient | undefined;

function getTranscribeClient(): TranscribeClient {
  if (!transcribeClient) {
    transcribeClient = new TranscribeClient({});
  }
  return transcribeClient;
}

/** Allow overriding the Transcribe client for testing */
export function setTranscribeClient(client: TranscribeClient): void {
  transcribeClient = client;
}

// --- Pure Functions ---

/**
 * Validate that maxSpeakerLabels is within the allowed range (2-10).
 * Exported for property-based testing.
 */
export function validateMaxSpeakers(value: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(value)) {
    return {
      valid: false,
      error: 'MaxSpeakerLabels は整数で指定してください。',
    };
  }
  if (value < 2 || value > 10) {
    return {
      valid: false,
      error: 'MaxSpeakerLabels は 2〜10 の範囲で指定してください。',
    };
  }
  return { valid: true };
}

// --- Service Functions ---

/**
 * Start a new transcription job.
 * - Validates maxSpeakerLabels
 * - Gets MediaFile from repository to obtain S3 key
 * - Calls Amazon Transcribe StartTranscriptionJob API
 * - Saves TranscriptionJob record to DynamoDB
 */
export async function startJob(params: StartJobParams): Promise<TranscriptionJob> {
  const {
    mediaFileId,
    maxSpeakerLabels = DEFAULT_MAX_SPEAKER_LABELS,
    languageCode = DEFAULT_LANGUAGE_CODE,
    languageModelName,
    user,
  } = params;
  const userId = user.userId;

  // Validate maxSpeakerLabels
  const validation = validateMaxSpeakers(maxSpeakerLabels);
  if (!validation.valid) {
    throw validationError(validation.error!);
  }

  // When a custom language model is requested, enforce team isolation.
  // A model the caller cannot access yields a 404 (hides existence).
  let crossTeamModelUsage = false;
  if (languageModelName) {
    const model = await checkLanguageModelAccess(user, languageModelName);

    // Flag ADMIN usage of a model owned by a team the admin does not belong to,
    // so the job-start audit log reflects the cross-team access.
    if (isAdmin(user)) {
      const teamIds = await getUserTeamIds(user.userId);
      if (!teamIds.includes(model.teamId)) {
        crossTeamModelUsage = true;
      }
    }
  }

  // Validate bucket configuration
  const mediaBucket = getMediaBucketName();
  const dataBucket = getDataBucketName();
  if (!mediaBucket || !dataBucket) {
    throw new AppError({
      code: 'CONFIGURATION_ERROR',
      message: 'バケットの設定が不足しています。',
      statusCode: 500,
      details: 'MEDIA_BUCKET_NAME or DATA_BUCKET_NAME environment variable is not set',
    });
  }

  // Get MediaFile to obtain S3 key
  const mediaFile = await mediaFileRepository.getById(mediaFileId);
  if (!mediaFile) {
    throw notFoundError('指定されたメディアファイルが見つかりません。');
  }

  // Generate unique job identifiers
  const jobId = uuidv4();
  const transcribeJobName = `tr-${uuidv4()}`;
  const outputKey = `transcriptions/${jobId}/output.json`;
  const now = new Date().toISOString();

  // Build Transcribe API parameters
  const transcribeParams: Record<string, unknown> = {
    TranscriptionJobName: transcribeJobName,
    Media: {
      MediaFileUri: `s3://${mediaBucket}/${mediaFile.s3Key}`,
    },
    OutputBucketName: dataBucket,
    OutputKey: outputKey,
    LanguageCode: languageCode,
    Settings: {
      ShowSpeakerLabels: true,
      MaxSpeakerLabels: maxSpeakerLabels,
    },
  };

  // Add custom language model if specified
  if (languageModelName) {
    transcribeParams['ModelSettings'] = {
      LanguageModelName: languageModelName,
    };
  }

  // Call Amazon Transcribe StartTranscriptionJob API
  await getTranscribeClient().send(
    new StartTranscriptionJobCommand(transcribeParams as any)
  );

  // Create TranscriptionJob record
  const jobRecord: TranscriptionJob = {
    jobId,
    transcribeJobName,
    mediaFileId,
    status: 'IN_PROGRESS' as TranscriptionJobStatus,
    languageCode,
    maxSpeakerLabels,
    languageModelName,
    outputS3Key: outputKey,
    startedBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  // Auto-create ReviewSession with PENDING status (Requirement 5.6).
  // This also supports re-transcription: a media file whose previous session
  // was deleted (its job reset to IN_PROGRESS) gets a brand-new session here,
  // and the media file is re-linked to it.
  try {
    // Auto-assign the session to the uploader (mediaFile.uploadedBy). When an
    // ADMIN uploads the media, the session is assigned to that admin.
    const session = await createSessionForJob(
      jobId,
      transcribeJobName,
      mediaFile.teamId,
      mediaFile.uploadedBy
    );

    // Reflect the linked session on the job record before persisting it.
    jobRecord.sessionId = session.sessionId;

    // Re-link the media file to the newly created session so that
    // session <-> media lookups (signed URLs, deletion cascade) stay consistent.
    await mediaFileRepository.updateSessionId(mediaFileId, session.sessionId);
  } catch {
    // ReviewSession creation failure should not block the job.
    // The job result is preserved and user can manually create a session later (Req 17.8).
  }

  // Save to DynamoDB (includes sessionId when the session was created successfully).
  await transcriptionJobRepository.save(jobRecord);

  // Reflect transcription progress on the media file so the media list shows
  // "処理中" instead of remaining stuck at "アップロード完了".
  // A failure here must not block the job, which is already started/persisted.
  try {
    await mediaFileRepository.updateStatus(mediaFileId, 'PROCESSING');
  } catch {
    // Non-fatal: the completion handler will still advance the status later.
  }

  // Record a job-start audit log. When a custom language model is used, the
  // model name is captured; an ADMIN using a model owned by a team they do not
  // belong to is flagged via crossTeamModelUsage so the usage is auditable.
  const auditMetadata: Record<string, unknown> = {
    mediaFileId,
    transcribeJobName,
  };
  if (languageModelName) {
    auditMetadata['languageModelName'] = languageModelName;
    if (crossTeamModelUsage) {
      auditMetadata['crossTeamModelUsage'] = true;
    }
  }
  await recordAuditLog({
    actorUserId: user.userId,
    actorRole: user.role,
    operationType: 'TRANSCRIPTION_JOB_STARTED',
    resourceId: jobId,
    resourceType: 'TranscriptionJob',
    metadata: auditMetadata,
  });

  return jobRecord;
}

/**
 * Get the status of a transcription job by its ID.
 * Reads from DynamoDB (cached status).
 */
export async function getJobStatus(jobId: string): Promise<TranscriptionJob> {
  const job = await transcriptionJobRepository.getById(jobId);
  if (!job) {
    throw notFoundError('指定された Transcription ジョブが見つかりません。');
  }
  return job;
}

/**
 * Get the real-time status of a transcription job from Amazon Transcribe API.
 * Calls GetTranscriptionJob API and updates the DynamoDB record if status has changed.
 * Used for 5-second polling (Requirement 17.10).
 */
export async function getJobStatusFromTranscribe(jobId: string): Promise<TranscriptionJob> {
  const job = await transcriptionJobRepository.getById(jobId);
  if (!job) {
    throw notFoundError('指定された Transcription ジョブが見つかりません。');
  }

  // If job is already in a terminal state, no need to poll Transcribe
  if (job.status === 'COMPLETED' || job.status === 'FAILED') {
    return job;
  }

  // Call Amazon Transcribe GetTranscriptionJob API
  const response = await getTranscribeClient().send(
    new GetTranscriptionJobCommand({
      TranscriptionJobName: job.transcribeJobName,
    })
  );

  const transcribeJob = response.TranscriptionJob;
  if (!transcribeJob) {
    return job;
  }

  const transcribeStatus = transcribeJob.TranscriptionJobStatus;
  let newStatus: TranscriptionJobStatus | undefined;
  let failureReason: string | undefined;

  if (transcribeStatus === 'COMPLETED') {
    newStatus = 'COMPLETED';
  } else if (transcribeStatus === 'FAILED') {
    newStatus = 'FAILED';
    failureReason = transcribeJob.FailureReason ?? 'Unknown error';
  }

  // Update DynamoDB if status changed
  if (newStatus && newStatus !== job.status) {
    await transcriptionJobRepository.updateStatus(jobId, newStatus, failureReason);

    // Keep the media file status in sync with the job outcome so the media
    // list reflects completion/failure even when detected via polling.
    // The COMPLETED case is normally handled by the process-job-complete
    // handler (which also parses segments); here we only mirror FAILED so the
    // media stops showing "処理中". Non-fatal on error.
    if (newStatus === 'FAILED') {
      try {
        await mediaFileRepository.updateStatus(job.mediaFileId, 'FAILED');
      } catch {
        // Non-fatal: job status is already persisted.
      }
    }

    return {
      ...job,
      status: newStatus,
      failureReason,
      updatedAt: new Date().toISOString(),
    };
  }

  return job;
}
