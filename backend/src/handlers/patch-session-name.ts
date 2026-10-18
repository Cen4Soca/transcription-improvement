import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
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
      throw validationError('sessionId パスパラメータが必要です。');
    }

    await checkSessionAccess(user, sessionId);

    const body = event.body ? JSON.parse(event.body) : null;
    if (!body || !body.name || typeof body.name !== 'string') {
      throw validationError('リクエストボディに name フィールドが必要です。');
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
        'セッション名の更新に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
