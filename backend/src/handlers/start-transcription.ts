import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { AppError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { startJob } from '../services/transcription-job-service.js';

/**
 * POST /transcription-jobs
 *
 * Starts a new transcription job using Amazon Transcribe.
 * - Validates JWT and extracts user
 * - Validates request body (mediaFileId required, optional params)
 * - Calls TranscriptionJobService.startJob()
 * - Returns the created TranscriptionJob record
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Parse and validate request body
    const body = parseRequestBody(event.body);

    // Start transcription job
    const job = await startJob({
      mediaFileId: body.mediaFileId,
      maxSpeakerLabels: body.maxSpeakerLabels,
      languageCode: body.languageCode,
      languageModelName: body.languageModelName,
      user,
    });

    return successResponse(job);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

interface StartTranscriptionRequestBody {
  mediaFileId: string;
  maxSpeakerLabels?: number;
  languageCode?: string;
  languageModelName?: string;
}

function parseRequestBody(rawBody: string | undefined): StartTranscriptionRequestBody {
  if (!rawBody) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'A request body is required.',
      statusCode: 400,
      errorCode: ERROR_CODES.REQUEST_BODY_REQUIRED,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'The request body is not valid JSON.',
      statusCode: 400,
      errorCode: ERROR_CODES.REQUEST_BODY_INVALID,
    });
  }

  const body = parsed as Record<string, unknown>;

  if (!body.mediaFileId || typeof body.mediaFileId !== 'string') {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'mediaFileId is required.',
      statusCode: 400,
      errorCode: ERROR_CODES.REQUEST_BODY_INVALID,
    });
  }

  const result: StartTranscriptionRequestBody = {
    mediaFileId: body.mediaFileId,
  };

  if (body.maxSpeakerLabels !== undefined) {
    if (typeof body.maxSpeakerLabels !== 'number') {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'maxSpeakerLabels must be a number.',
        statusCode: 400,
        errorCode: ERROR_CODES.REQUEST_BODY_INVALID,
      });
    }
    result.maxSpeakerLabels = body.maxSpeakerLabels;
  }

  if (body.languageCode !== undefined) {
    if (typeof body.languageCode !== 'string') {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'languageCode must be a string.',
        statusCode: 400,
        errorCode: ERROR_CODES.REQUEST_BODY_INVALID,
      });
    }
    result.languageCode = body.languageCode;
  }

  if (body.languageModelName !== undefined) {
    if (typeof body.languageModelName !== 'string') {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'languageModelName must be a string.',
        statusCode: 400,
        errorCode: ERROR_CODES.REQUEST_BODY_INVALID,
      });
    }
    result.languageModelName = body.languageModelName;
  }

  return result;
}
