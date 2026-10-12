import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../utils/error-handler.js';

// --- Constants ---

export const ALLOWED_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'amr', 'webm',
  'mp4', 'mkv', 'avi', 'mov',
] as const;

export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

export const PRESIGNED_URL_EXPIRY_SECONDS = 300;

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME ?? '';

// --- Interfaces ---

export interface ValidateUploadParams {
  filename: string;
  fileSize: number;
}

export interface ValidateUploadResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
  supportedFormats?: string[];
  maxFileSize?: string;
}

export interface GenerateUrlParams {
  mediaFileId: string;
  filename: string;
  contentType: string;
  userId: string;
  teamId?: string;
}

export interface PresignedUrlResult {
  presignedUrl: string;
  mediaFileId: string;
  s3Key: string;
  expiresAt: string;
}

// --- S3 Client (lazy singleton) ---

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

// --- Pure Functions ---

/**
 * Extract the file extension from a filename (lowercase, without dot).
 */
export function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Validate upload file format and size.
 * Pure function — no side effects.
 */
export function validateUpload(params: ValidateUploadParams): ValidateUploadResult {
  const { filename, fileSize } = params;

  // Validate file extension
  const ext = extractExtension(filename);
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      valid: false,
      error: 'サポートされていないファイル形式です。サポートされる形式: mp3, wav, flac, ogg, m4a, amr, webm, mp4, mkv, avi, mov',
      errorCode: 'UNSUPPORTED_FILE_FORMAT',
      supportedFormats: [...ALLOWED_EXTENSIONS],
    };
  }

  // Validate file size
  if (fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: 'ファイルサイズが上限を超えています。最大ファイルサイズ: 2GB',
      errorCode: 'FILE_SIZE_EXCEEDED',
      maxFileSize: '2GB',
    };
  }

  if (fileSize <= 0) {
    return {
      valid: false,
      error: 'ファイルサイズが無効です。',
      errorCode: 'INVALID_FILE_SIZE',
    };
  }

  return { valid: true };
}

/**
 * Generate S3 key for media file upload.
 * Pattern: media/{mediaFileId}/{filename}
 * Pure function — no side effects.
 */
export function generateS3Key(mediaFileId: string, filename: string): string {
  return `media/${mediaFileId}/${filename}`;
}

// --- Async Functions ---

/**
 * Generate a unique mediaFileId (UUID v4).
 */
export function generateMediaFileId(): string {
  return uuidv4();
}

/**
 * Generate a presigned URL for S3 PutObject.
 * Expiry: 300 seconds (5 minutes).
 */
export async function generatePresignedUrl(params: GenerateUrlParams): Promise<PresignedUrlResult> {
  const { mediaFileId, filename, contentType } = params;

  if (!MEDIA_BUCKET_NAME) {
    throw new AppError({
      code: 'CONFIGURATION_ERROR',
      message: 'メディアバケットの設定が不足しています。',
      statusCode: 500,
      details: 'MEDIA_BUCKET_NAME environment variable is not set',
    });
  }

  const s3Key = generateS3Key(mediaFileId, filename);

  const command = new PutObjectCommand({
    Bucket: MEDIA_BUCKET_NAME,
    Key: s3Key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

  return {
    presignedUrl,
    mediaFileId,
    s3Key,
    expiresAt,
  };
}
