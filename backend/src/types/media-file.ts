/**
 * MediaFile entity type definitions and DynamoDB key design constants.
 */

// --- Status type ---

export type MediaFileStatus = 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type ScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED';

// --- Entity interface ---

export interface MediaFile {
  mediaFileId: string;          // UUID
  filename: string;             // 元のファイル名
  s3Key: string;                // S3 オブジェクトキー (media/{mediaFileId}/{filename})
  contentType: string;          // MIME type
  fileSize: number;             // バイト数
  uploadedBy: string;           // userId
  teamId?: string;              // アップロードユーザーのチームID
  status: MediaFileStatus;
  scanStatus?: ScanStatus;      // マルウェアスキャン結果
  sessionId?: string;           // 紐づく ReviewSession ID（Transcription完了後に設定）
  createdAt: string;            // ISO 8601 UTC
  updatedAt: string;
}

// --- DynamoDB key design constants ---

export const MEDIA_FILE_KEYS = {
  /** PK: MEDIA#{mediaFileId} */
  pk: (mediaFileId: string) => `MEDIA#${mediaFileId}`,
  /** SK: METADATA */
  sk: 'METADATA' as const,
  /** GSI1PK: TEAM#{teamId} */
  gsi1pk: (teamId: string) => `TEAM#${teamId}`,
  /** GSI1SK: MEDIA#{createdAt}#{mediaFileId} */
  gsi1sk: (createdAt: string, mediaFileId: string) => `MEDIA#${createdAt}#${mediaFileId}`,
  /** GSI2PK: USER#{uploadedBy} */
  gsi2pk: (uploadedBy: string) => `USER#${uploadedBy}`,
  /** GSI2SK: MEDIA#{createdAt}#{mediaFileId} */
  gsi2sk: (createdAt: string, mediaFileId: string) => `MEDIA#${createdAt}#${mediaFileId}`,
} as const;

export const MEDIA_FILE_ENTITY_TYPE = 'MediaFile' as const;
