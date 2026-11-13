import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { notFoundError, forbiddenError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import * as sessionRepository from '../repositories/session-repository.js';
import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import type { MediaFile } from '../types/media-file.js';

export interface MediaUrlResult {
  data: {
    url: string;
    expiresAt: string;
  };
}

/** Signed URL expiration: 300 seconds (5 minutes) */
const SIGNED_URL_EXPIRATION_SECONDS = 300;

/**
 * Media bucket name (from environment).
 * Injected via commonEnv in the API stack.
 * Read at call time (not module load) so tests can set it after import.
 */
function getMediaBucketName(): string {
  return process.env.MEDIA_BUCKET_NAME ?? '';
}

/** S3 client (lazy singleton) */
let s3Client: S3Client | undefined;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'ap-northeast-1' });
  }
  return s3Client;
}

/** Allow overriding the S3 client for testing */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

/**
 * Resolve a MediaFile for a session when the direct MediaFile.sessionId link is
 * missing, by walking session -> transcriptionJob -> mediaFileId.
 *
 * This is the fallback path for the media-link bug: when a (re-)transcription's
 * updateSessionId failed and the link was lost, getBySessionId returns null.
 * We recover the MediaFile from the session's transcriptionJobId (session ->
 * job -> mediaFileId -> MediaFile) and, on success, compensate the broken link
 * via updateSessionId so subsequent getBySessionId lookups succeed (self-heal).
 *
 * Returns the resolved MediaFile, or null when it cannot be resolved.
 */
async function resolveMediaFileFallback(
  sessionId: string
): Promise<MediaFile | null> {
  const session = await sessionRepository.getSessionById(sessionId);
  if (!session?.transcriptionJobId) {
    return null;
  }

  const job = await transcriptionJobRepository.getById(
    session.transcriptionJobId
  );
  if (!job?.mediaFileId) {
    return null;
  }

  const mediaFile = await mediaFileRepository.getById(job.mediaFileId);
  if (!mediaFile) {
    return null;
  }

  // Compensate the broken link (self-heal) so future getBySessionId lookups
  // resolve the MediaFile directly without needing this fallback.
  await mediaFileRepository.updateSessionId(mediaFile.mediaFileId, sessionId);

  return mediaFile;
}

/**
 * Get the MediaFile record for a session and validate scanStatus.
 * - If no MediaFile found: throws 404
 * - If scanStatus is PENDING: throws 403
 * - If scanStatus is INFECTED: throws 403
 * - If scanStatus is CLEAN: returns the MediaFile
 *
 * When the direct MediaFile.sessionId lookup (getBySessionId) returns null, a
 * fallback resolves the MediaFile via session -> transcriptionJob -> mediaFileId
 * and compensates the missing link (self-heal). The scanStatus gating below is
 * applied to the resolved MediaFile unchanged. The linked path
 * (getBySessionId non-null) is untouched by this fallback.
 */
export async function getMediaFileForSession(sessionId: string) {
  const mediaFile =
    (await mediaFileRepository.getBySessionId(sessionId)) ??
    (await resolveMediaFileFallback(sessionId));

  if (!mediaFile) {
    throw notFoundError(
      'Media file not found',
      `No media file found for session ${sessionId}`,
      ERROR_CODES.MEDIA_FILE_NOT_FOUND
    );
  }

  if (!mediaFile.scanStatus || mediaFile.scanStatus === 'PENDING') {
    throw forbiddenError(
      'This file cannot be accessed until the malware scan is complete.',
      `Media file ${mediaFile.mediaFileId} scan is pending`,
      ERROR_CODES.MEDIA_SCAN_PENDING
    );
  }

  if (mediaFile.scanStatus === 'INFECTED') {
    throw forbiddenError(
      'This file cannot be accessed because malware was detected.',
      `Media file ${mediaFile.mediaFileId} is infected`,
      ERROR_CODES.MEDIA_MALWARE_DETECTED
    );
  }

  return mediaFile;
}

/**
 * Generate an S3 pre-signed URL (GetObject) for the given media file S3 key.
 *
 * NOTE: We intentionally use an S3 pre-signed URL (host: s3.<region>.amazonaws.com)
 * instead of a CloudFront Signed URL. The frontend is co-hosted on another project's
 * CloudFront distribution whose Content-Security-Policy allows `media-src https://*.amazonaws.com`
 * but NOT `*.cloudfront.net`. Serving media over the S3 endpoint keeps playback within
 * the enforced CSP without requiring changes to the shared distribution.
 *
 * Uses @aws-sdk/s3-request-presigner for SigV4 signing. Expiry: 300 seconds (5 minutes).
 */
export async function generateSignedUrl(s3Key: string): Promise<{ url: string; expiresAt: string }> {
  const mediaBucketName = getMediaBucketName();
  if (!mediaBucketName) {
    throw internalError(
      'Media URL generation is not configured.',
      'Missing MEDIA_BUCKET_NAME',
      ERROR_CODES.MEDIA_CONFIG_MISSING
    );
  }

  if (!s3Key) {
    throw internalError(
      'Failed to generate the media URL.',
      'Media file record has an empty s3Key',
      ERROR_CODES.MEDIA_URL_GENERATION_FAILED
    );
  }

  const command = new GetObjectCommand({
    Bucket: mediaBucketName,
    Key: s3Key,
  });

  const url = await getSignedUrl(getS3Client(), command, {
    expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
  });

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRATION_SECONDS * 1000).toISOString();

  return {
    url,
    expiresAt,
  };
}

/**
 * Get a signed media URL for a session.
 * 1. Looks up MediaFile record by sessionId
 * 2. Validates scanStatus (CLEAN only)
 * 3. Generates an S3 pre-signed URL with 300s expiry
 * Returns: { data: { url, expiresAt } }
 */
export async function getMediaUrl(sessionId: string): Promise<MediaUrlResult> {
  const mediaFile = await getMediaFileForSession(sessionId);
  const { url, expiresAt } = await generateSignedUrl(mediaFile.s3Key);

  return {
    data: {
      url,
      expiresAt,
    },
  };
}
