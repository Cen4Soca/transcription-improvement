import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { errorResponse } from '../utils/response-builder.js';
import { AppError, notFoundError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import {
  generateJson,
  generateSrt,
  generateDownloadFilename,
} from '../services/download-service.js';
import * as sessionRepository from '../repositories/session-repository.js';

const ALLOWED_FORMATS = ['json', 'srt'] as const;
type DownloadFormat = (typeof ALLOWED_FORMATS)[number];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

/**
 * GET /sessions/{sessionId}/download?format=json|srt
 *
 * Downloads the corrected transcription in the specified format.
 * - Validates JWT and extracts user
 * - Extracts sessionId from path parameters
 * - Extracts format from query parameters (default: json)
 * - Calls DownloadService to generate the file content
 * - Returns the file with Content-Disposition header for browser download
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    // Validate user authentication
    const user = await extractUser(event);

    // Extract sessionId from path parameters
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'The sessionId path parameter is required.',
        statusCode: 400,
        errorCode: ERROR_CODES.SESSION_ID_REQUIRED,
      });
    }

    // Extract and validate format from query parameters
    const format = (event.queryStringParameters?.format ?? 'json') as string;
    if (!isValidFormat(format)) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: `Invalid download format: ${format}`,
        statusCode: 400,
        details: `Supported formats: ${ALLOWED_FORMATS.join(', ')}`,
        errorCode: ERROR_CODES.DOWNLOAD_FORMAT_INVALID,
      });
    }

    const now = new Date();

    if (format === 'json') {
      const jsonData = await generateJson(sessionId, user.userId);
      const filename = generateDownloadFilename(jsonData.sessionName, now, 'json');

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
          ...CORS_HEADERS,
        },
        body: JSON.stringify(jsonData),
      };
    }

    // format === 'srt'
    // Get session name for filename before generating SRT content
    const session = await sessionRepository.getSessionById(sessionId);
    if (!session) {
      throw notFoundError(
        'ReviewSession not found',
        undefined,
        ERROR_CODES.REVIEW_SESSION_NOT_FOUND
      );
    }

    const srtContent = await generateSrt(sessionId, user.userId);
    const filename = generateDownloadFilename(session.name, now, 'srt');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...CORS_HEADERS,
      },
      body: srtContent,
    };
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function isValidFormat(format: string): format is DownloadFormat {
  return ALLOWED_FORMATS.includes(format as DownloadFormat);
}
