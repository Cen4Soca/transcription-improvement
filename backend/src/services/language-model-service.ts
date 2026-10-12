import {
  TranscribeClient,
  CreateLanguageModelCommand,
  ListLanguageModelsCommand,
  DescribeLanguageModelCommand,
  BaseModelName,
} from '@aws-sdk/client-transcribe';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { AppError, forbiddenError, validationError } from '../utils/error-handler.js';
import { recordAuditLog } from './audit-service.js';

// --- Constants ---

const ALLOWED_ROLES = ['ADMIN', 'TEAM_LEADER'] as const;
const LANGUAGE_CODE = 'ja-JP';

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
  segments: ConfirmedSegment[];
  sessionIds: string[];
  userId: string;
  userRole: string;
}

export interface ConfirmedSegment {
  text: string;
  confirmed: boolean;
}

export interface LanguageModelRecord {
  modelName: string;
  baseModelName: string;
  status: string;
  trainingDataS3Uri: string;
  createdBy: string;
  createdAt: string;
}

export interface LanguageModelSummary {
  modelName: string;
  modelStatus: string;
  baseModelName?: string;
  createTime?: string;
}

export interface LanguageModelStatus {
  modelName: string;
  modelStatus: string;
  baseModelName?: string;
  failureReason?: string;
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
 * - Check role access (Admin/TeamLeader only)
 * - Check model name duplicate
 * - Generate training data from confirmed segments
 * - Upload training data to S3
 * - Call Transcribe CreateLanguageModel API
 */
export async function createModel(params: CreateModelParams): Promise<LanguageModelRecord> {
  const { modelName, baseModelName, segments, sessionIds, userId, userRole } = params;

  // Check role access
  if (!checkRoleAccess(userRole)) {
    throw forbiddenError('カスタム言語モデル作成機能へのアクセスが拒否されました。');
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

  // Call Transcribe CreateLanguageModel API
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

  const now = new Date().toISOString();

  // Record AuditLog (LANGUAGE_MODEL_CREATED)
  await recordAuditLog({
    actorUserId: userId,
    actorRole: userRole as 'ADMIN' | 'TEAM_LEADER' | 'REVIEWER',
    operationType: 'LANGUAGE_MODEL_CREATED',
    resourceId: modelName,
    resourceType: 'LanguageModel',
    metadata: {
      baseModelName,
      sessionIds: sessionIds.join(','),
    },
  });

  return {
    modelName,
    baseModelName,
    status: 'IN_PROGRESS',
    trainingDataS3Uri,
    createdBy: userId,
    createdAt: now,
  };
}

/**
 * List language models, filtered to COMPLETED status only.
 */
export async function listModels(): Promise<LanguageModelSummary[]> {
  const client = getTranscribeClient();

  const response = await client.send(new ListLanguageModelsCommand({}));

  const models: LanguageModelSummary[] = (response.Models ?? []).map((model) => ({
    modelName: model.ModelName ?? '',
    modelStatus: model.ModelStatus ?? '',
    baseModelName: model.BaseModelName,
    createTime: model.CreateTime?.toISOString(),
  }));

  return filterCompletedModels(models);
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
