/**
 * TranscriptionJob entity type definitions and DynamoDB key design constants.
 */

// --- Status type ---

export type TranscriptionJobStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

// --- Entity interface ---

export interface TranscriptionJob {
  jobId: string;                // UUID（App内部ID）
  transcribeJobName: string;    // Amazon Transcribe ジョブ名
  mediaFileId: string;          // 対象メディアファイルID
  status: TranscriptionJobStatus;
  languageCode: string;         // ja-JP, en-US, etc.
  maxSpeakerLabels: number;     // 2-10
  languageModelName?: string;   // カスタム言語モデル名（オプション）
  outputS3Key?: string;         // Transcribe出力の S3 キー
  sessionId?: string;           // 作成された ReviewSession ID
  failureReason?: string;       // 失敗理由
  startedBy: string;            // userId
  createdAt: string;            // ISO 8601 UTC
  updatedAt: string;
}

// --- DynamoDB key design constants ---

export const TRANSCRIPTION_JOB_KEYS = {
  /** PK: JOB#{jobId} */
  pk: (jobId: string) => `JOB#${jobId}`,
  /** SK: METADATA */
  sk: 'METADATA' as const,
  /** GSI1PK: MEDIA#{mediaFileId} */
  gsi1pk: (mediaFileId: string) => `MEDIA#${mediaFileId}`,
  /** GSI1SK: JOB#{createdAt}#{jobId} */
  gsi1sk: (createdAt: string, jobId: string) => `JOB#${createdAt}#${jobId}`,
  /** GSI2PK: TRANSCRIBE#{transcribeJobName} */
  gsi2pk: (transcribeJobName: string) => `TRANSCRIBE#${transcribeJobName}`,
  /** GSI2SK: JOB#{createdAt} */
  gsi2sk: (createdAt: string) => `JOB#${createdAt}`,
} as const;

export const TRANSCRIPTION_JOB_ENTITY_TYPE = 'TranscriptionJob' as const;
