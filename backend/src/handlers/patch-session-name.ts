import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { renameSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * PATCH /sessions/{sessionId}/name
 *
 * Updates the name of a ReviewSession.
 * - Validates JWT and extracts user
 * - Validates sessionId path parameter
 * - Checks session access (team-based)
 * - Validates request body (name: non-empty string, trimmed 1-100 characters)
 * - Updates session name in DynamoDB
 * - Records a SESSION_NAME_CHANGED audit log
 * - Returns updated session
 *
 * Request body:
 *   { "name": string }
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

    const body = event.body ? JSON.parse(event.body) : null;
    if (!body || !body.name || typeof body.name !== 'string') {
      throw validationError(
        'The request body must include a name field.',
        undefined,
        ERROR_CODES.SESSION_NAME_FIELD_REQUIRED
      );
    }

    try {
      const updatedSession = await renameSession(sessionId, body.name);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'SESSION_NAME_CHANGED',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: { name: updatedSession.name },
      });

      return successResponse({ data: updatedSession });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'Failed to update the session name.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.SESSION_NAME_UPDATE_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
