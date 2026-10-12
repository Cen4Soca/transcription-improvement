/**
 * POST /sessions/{sessionId}/reopen
 *
 * Reopen a COMPLETED review session back to IN_PROGRESS (進行中に戻す).
 *
 * Business context:
 * When the transcription quality of a completed session is poor, an ADMIN or
 * TEAM_LEADER can send the session back to IN_PROGRESS so reviewers can keep
 * correcting it. Confirmed consensus results and segment statuses are preserved
 * (policy A) — only the session status changes.
 *
 * Behavior:
 * - ADMIN may reopen any session; TEAM_LEADER only sessions in their own team.
 * - Only COMPLETED sessions can be reopened; others are rejected with 400.
 * - Records a SESSION_REOPENED audit log on success.
 *
 * Response:
 *   { data: { sessionId, status } }
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { reopenSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パスパラメータが必要です。');
    }

    const updated = await reopenSession(user, sessionId);

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'SESSION_REOPENED',
      resourceId: sessionId,
      resourceType: 'ReviewSession',
    });

    return successResponse({
      data: {
        sessionId,
        status: updated.status,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
