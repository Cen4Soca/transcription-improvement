import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { AppError, validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { getSessionProgress } from '../services/monitoring-service.js';

/**
 * GET /sessions/{sessionId}/progress
 *
 * Per-reviewer review progress of one session for ADMIN and TEAM_LEADER.
 * - Progress = unique segments with a TEXT correction / total segments.
 * - A session outside the caller's scope (or missing) returns 404; REVIEWER gets 403.
 *
 * Response:
 *   { data: SessionProgress }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const sessionId = event.pathParameters?.['sessionId'];
    if (!sessionId) {
      throw validationError(
        'The sessionId path parameter is required.',
        undefined,
        ERROR_CODES.SESSION_ID_REQUIRED
      );
    }

    try {
      const progress = await getSessionProgress(user, sessionId);
      return successResponse({ data: progress });
    } catch (serviceError: unknown) {
      if (serviceError instanceof AppError) {
        throw serviceError;
      }
      throw internalError(
        'Failed to retrieve session progress.',
        serviceError instanceof Error ? serviceError.message : undefined,
        ERROR_CODES.SESSION_PROGRESS_FETCH_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
