import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { suggestSessionName } from '../services/session-name-suggestion-service.js';

/**
 * GET /sessions/{sessionId}/name-suggestion
 *
 * Suggests a concise Japanese session name derived from the session's
 * transcription segment text via Amazon Bedrock (Claude).
 *
 * - Validates JWT and extracts user
 * - Validates sessionId path parameter
 * - Checks session access (team-based); hidden as 404 when inaccessible
 * - Returns { suggestion: string | null, hasExternalApiError: boolean }
 *   where suggestion is always 100 characters or fewer
 * - On Bedrock failure, suggestSessionName returns suggestion:null +
 *   hasExternalApiError:true (not an error response)
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
      const result = await suggestSessionName(sessionId);
      return successResponse(result);
    } catch (error: unknown) {
      throw internalError(
        'Failed to retrieve a session name suggestion.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.SESSION_NAME_SUGGESTION_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
