import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { joinSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * POST /sessions/{sessionId}/join
 *
 * Lets the authenticated reviewer join a session assigned to one of their teams.
 * - Sessions are shared: multiple reviewers can join the same session so their
 *   corrections can be aggregated by consensus. Joining is idempotent.
 * - ADMIN may join any session; REVIEWER/TEAM_LEADER only their team's sessions.
 * - Records a REVIEW_ASSIGNMENT_CHANGE audit log.
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
      const joinedSession = await joinSession(user, sessionId);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'REVIEW_ASSIGNMENT_CHANGE',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
      });

      return successResponse({ data: joinedSession });
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
