import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { getCorrections } from '../repositories/correction-repository.js';

/**
 * GET /sessions/{sessionId}/corrections
 *
 * Retrieves all corrections for the authenticated user in the specified session.
 * Used to restore corrections when a ReviewSession is re-opened.
 * - Validates JWT and extracts user
 * - Validates sessionId path parameter
 * - Checks session access (team-based)
 * - Queries corrections sorted chronologically (ascending)
 * - Returns empty array if no corrections found
 * - Returns error response on query failure (client should open session in unmodified state)
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError(
        'The sessionId path parameter is required.',
        undefined,
        ERROR_CODES.SESSION_ID_REQUIRED
      );
    }

    await checkSessionAccess(user, sessionId);

    try {
      const corrections = await getCorrections(sessionId, user.userId);
      return successResponse({ data: corrections });
    } catch (queryError: unknown) {
      throw internalError(
        'Failed to restore the corrections.',
        queryError instanceof Error ? queryError.message : undefined,
        ERROR_CODES.CORRECTION_RESTORE_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
