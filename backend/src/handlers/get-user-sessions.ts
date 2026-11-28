import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { AppError, validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { listUserSessions } from '../services/monitoring-service.js';

/**
 * GET /monitoring/users/{userId}/sessions
 *
 * Sessions a user participates in, with that user's own progress per session,
 * for ADMIN and TEAM_LEADER.
 * - TEAM_LEADER may only view members of their own teams (others return 404).
 * - REVIEWER: 403.
 *
 * Response:
 *   { data: { items: UserSessionItem[] } }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const userId = event.pathParameters?.['userId'];
    if (!userId) {
      throw validationError(
        'The userId path parameter is required.',
        undefined,
        ERROR_CODES.USER_ID_REQUIRED
      );
    }

    try {
      const items = await listUserSessions(user, userId);
      return successResponse({ data: { items } });
    } catch (serviceError: unknown) {
      if (serviceError instanceof AppError) {
        throw serviceError;
      }
      throw internalError(
        'Failed to retrieve the user sessions.',
        serviceError instanceof Error ? serviceError.message : undefined,
        ERROR_CODES.USER_SESSIONS_FETCH_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
