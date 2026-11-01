import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { selfAssignSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * POST /sessions/{sessionId}/self-assign
 *
 * Lets the authenticated reviewer self-assign (join) a session assigned to one
 * of their teams, without waiting for a TEAM_LEADER/ADMIN assignment.
 * - REVIEWER/TEAM_LEADER: only their team's sessions; ADMIN: any session.
 * - Idempotent (addParticipant). Records a REVIEW_ASSIGNMENT_CHANGE audit log
 *   with reason 'self-assign'.
 *
 * Response:
 *   { data: SessionRecord }
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

    try {
      const session = await selfAssignSession(user, sessionId);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'REVIEW_ASSIGNMENT_CHANGE',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: { reason: 'self-assign' },
      });

      return successResponse({ data: session });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'Failed to join the session.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.SESSION_JOIN_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
