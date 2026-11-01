import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { assignSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * PATCH /sessions/{sessionId}/assignment
 *
 * (Re)assigns a session to a user and/or a team.
 * - ADMIN: may assign to any user/team.
 * - TEAM_LEADER: may assign only within their own team.
 * - REVIEWER: forbidden (403).
 * - Records a REVIEW_ASSIGNMENT_CHANGE audit log.
 *
 * Request body (at least one of):
 *   { "assignedUserId"?: string, "assignedTeamId"?: string }
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

    const body = event.body ? JSON.parse(event.body) : null;
    if (!body || (!body.assignedUserId && !body.assignedTeamId)) {
      throw validationError(
        'The request body must include assignedUserId or assignedTeamId.',
        undefined,
        ERROR_CODES.SESSION_ASSIGN_TARGET_REQUIRED
      );
    }

    if (body.assignedUserId !== undefined && typeof body.assignedUserId !== 'string') {
      throw validationError(
        'assignedUserId must be a string.',
        undefined,
        ERROR_CODES.SESSION_ASSIGNED_USER_ID_INVALID
      );
    }
    if (body.assignedTeamId !== undefined && typeof body.assignedTeamId !== 'string') {
      throw validationError(
        'assignedTeamId must be a string.',
        undefined,
        ERROR_CODES.SESSION_ASSIGNED_TEAM_ID_INVALID
      );
    }

    try {
      const updatedSession = await assignSession(user, sessionId, {
        assignedUserId: body.assignedUserId,
        assignedTeamId: body.assignedTeamId,
      });

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'REVIEW_ASSIGNMENT_CHANGE',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: {
          assignedUserId: body.assignedUserId,
          assignedTeamId: body.assignedTeamId,
        },
      });

      return successResponse({ data: updatedSession });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'Failed to assign the session.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.SESSION_ASSIGNMENT_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
