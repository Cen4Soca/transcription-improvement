import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { AppError } from '../utils/error-handler.js';
import {
  validateUpload,
  generatePresignedUrl,
  generateMediaFileId,
} from '../services/upload-service.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import type { MediaFile } from '../types/media-file.js';

/**
 * POST /upload-url
 *
 * Generates a presigned URL for media file upload to S3.
 * - Validates JWT and extracts user
 * - Validates request body (filename, contentType, fileSize)
 * - Validates file format and size
 * - Generates a presigned URL for S3 PutObject
 * - Returns the presigned URL with mediaFileId and s3Key
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Parse request body
    const body = parseRequestBody(event.body);

    // Validate upload (file format and size)
    const validation = validateUpload({
      filename: body.filename,
      fileSize: body.fileSize,
    });

    if (!validation.valid) {
      const errorBody: Record<string, unknown> = {
        code: validation.errorCode ?? 'VALIDATION_ERROR',
        message: validation.error ?? 'バリデーションエラーが発生しました。',
      };

      if (validation.supportedFormats) {
        errorBody.details = `サポートされる形式: ${validation.supportedFormats.join(', ')}`;
        errorBody.supportedFormats = validation.supportedFormats;
      }

      if (validation.maxFileSize) {
        errorBody.details = `最大ファイルサイズ: ${validation.maxFileSize}`;
        errorBody.maxFileSize = validation.maxFileSize;
      }

      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        },
        body: JSON.stringify({ error: errorBody }),
      };
    }

    // Generate mediaFileId
    const mediaFileId = generateMediaFileId();

    // Extract teamId from JWT claims (optional)
    const teamId = event.requestContext.authorizer.jwt.claims['custom:teamId'] as string | undefined;

    // Generate presigned URL
    const result = await generatePresignedUrl({
      mediaFileId,
      filename: body.filename,
      contentType: body.contentType,
      userId: user.userId,
      teamId: teamId || undefined,
    });

    // Pre-create the MediaFile metadata record so that the uploader (uploadedBy)
    // is recorded. The S3 ObjectCreated event (process-upload) is idempotent and
    // will not overwrite this record, so uploadedBy is preserved.
    await createInitialMediaFileRecord({
      mediaFileId,
      filename: body.filename,
      s3Key: result.s3Key,
      contentType: body.contentType,
      fileSize: body.fileSize,
      uploadedBy: user.userId,
      teamId: teamId || undefined,
    });

    return successResponse(result);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

interface UploadUrlRequestBody {
  filename: string;
  contentType: string;
  fileSize: number;
}

function parseRequestBody(rawBody: string | undefined): UploadUrlRequestBody {
  if (!rawBody) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが必要です。',
      statusCode: 400,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディのJSON形式が不正です。',
      statusCode: 400,
    });
  }

  const body = parsed as Record<string, unknown>;

  if (!body.filename || typeof body.filename !== 'string') {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'filename は必須です。',
      statusCode: 400,
    });
  }

  if (!body.contentType || typeof body.contentType !== 'string') {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'contentType は必須です。',
      statusCode: 400,
    });
  }

  if (body.fileSize === undefined || typeof body.fileSize !== 'number') {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'fileSize は必須です。',
      statusCode: 400,
    });
  }

  return {
    filename: body.filename,
    contentType: body.contentType,
    fileSize: body.fileSize,
  };
}

/**
 * Pre-create the MediaFile metadata record at presigned-URL issue time so that
 * the uploader (uploadedBy) and team are recorded. Uses status UPLOADING until
 * the S3 upload completes and the malware scan / process-upload flow updates it.
 */
async function createInitialMediaFileRecord(input: {
  mediaFileId: string;
  filename: string;
  s3Key: string;
  contentType: string;
  fileSize: number;
  uploadedBy: string;
  teamId?: string;
}): Promise<void> {
  const now = new Date().toISOString();

  const record: MediaFile = {
    mediaFileId: input.mediaFileId,
    filename: input.filename,
    s3Key: input.s3Key,
    contentType: input.contentType,
    fileSize: input.fileSize,
    uploadedBy: input.uploadedBy,
    teamId: input.teamId,
    status: 'UPLOADING',
    scanStatus: 'PENDING',
    createdAt: now,
    updatedAt: now,
  };

  await mediaFileRepository.save(record);
}
