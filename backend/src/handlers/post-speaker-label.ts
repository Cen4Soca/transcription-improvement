import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { addSpeakerLabel } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * POST /sessions/{sessionId}/speaker-labels
 *
 * Adds a speaker label to a ReviewSession's master list.
 * - Validates JWT and extracts user
 * - Validates sessionId path parameter
 * - Checks session access (team-based; inaccessible -> 404)
 * - Validates request body (label: non-empty string)
 * - Adds the label via the session service (rejects empty / duplicate)
 * - Records a SPEAKER_LABEL_CHANGED audit log with { action: 'ADD', label }
 * - Returns the updated session
 *
 * Request body:
 *   { "label": string }
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
    if (!body || typeof body.label !== 'string') {
      throw validationError('リクエストボディに label フィールドが必要です。');
    }

    try {
      const updatedSession = await addSpeakerLabel(sessionId, body.label);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'SPEAKER_LABEL_CHANGED',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: { action: 'ADD', label: body.label.trim() },
      });

      return successResponse({ data: updatedSession });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        '話者ラベルの追加に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
