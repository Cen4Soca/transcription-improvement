import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { deleteSpeakerLabel } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * DELETE /sessions/{sessionId}/speaker-labels/{label}
 *
 * Deletes a speaker label from a ReviewSession's master list.
 * - Validates JWT and extracts user
 * - Validates sessionId and label path parameters (label is URL-decoded once)
 * - Checks session access (team-based; inaccessible -> 404)
 * - Deletes the label via the session service, which rejects a label still in
 *   use by any segment (validationError) and a non-existent label (notFound)
 * - Records a SPEAKER_LABEL_CHANGED audit log with { action: 'DELETE', label }
 * - Returns the updated session
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

    const rawLabel = event.pathParameters?.label;
    if (!rawLabel) {
      throw validationError('label パスパラメータが必要です。');
    }
    const label = decodeURIComponent(rawLabel);
    if (label.length === 0) {
      throw validationError('label パスパラメータが必要です。');
    }

    await checkSessionAccess(user, sessionId);

    try {
      const updatedSession = await deleteSpeakerLabel(sessionId, label);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'SPEAKER_LABEL_CHANGED',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: { action: 'DELETE', label },
      });

      return successResponse({ data: updatedSession });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        '話者ラベルの削除に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
