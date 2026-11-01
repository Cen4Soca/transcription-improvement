import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { changeSessionStatus } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * PATCH /sessions/{sessionId}/status
 *
 * Updates the status of a ReviewSession.
 * - Validates JWT and extracts user
 * - Validates sessionId path parameter
 * - Checks session access (team-based)
 * - Validates request body (status: PENDING | IN_PROGRESS | COMPLETED)
 * - Validates status transition
 * - Updates session status in DynamoDB
 * - Returns updated session
 *
 * Request body:
 *   { "status": "PENDING" | "IN_PROGRESS" | "COMPLETED" }
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
    if (!body || !body.status) {
      throw validationError(
        'The request body must include a status field.',
        undefined,
        ERROR_CODES.SESSION_STATUS_REQUIRED
      );
    }

    try {
      const updatedSession = await changeSessionStatus(sessionId, body.status);

      // Record audit log when session is marked as completed
      if (body.status === 'COMPLETED') {
        await recordAuditLog({
          actorUserId: user.userId,
          actorRole: user.role,
          operationType: 'SESSION_COMPLETED',
          resourceId: sessionId,
          resourceType: 'ReviewSession',
        });
      }

      return successResponse({ data: updatedSession });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'Failed to update the session status.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.SESSION_STATUS_UPDATE_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
