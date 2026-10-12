import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { renameModelDisplayName } from '../services/language-model-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * PATCH /language-models/{modelName}/name
 *
 * Updates the human-readable display name of a custom language model.
 * - Validates JWT and extracts user
 * - Validates the modelName path parameter
 * - Validates request body (name: non-empty string)
 * - Delegates team isolation + role + trim/length/uniqueness checks to the
 *   service (renameModelDisplayName)
 * - Records a LANGUAGE_MODEL_NAME_CHANGED audit log
 * - Returns the updated model metadata
 *
 * Request body:
 *   { "name": string }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const modelName = event.pathParameters?.modelName;
    if (!modelName) {
      throw validationError('modelName パスパラメータが必要です。');
    }

    const body = event.body ? JSON.parse(event.body) : null;
    if (!body || !body.name || typeof body.name !== 'string') {
      throw validationError('リクエストボディに name フィールドが必要です。');
    }

    try {
      const updated = await renameModelDisplayName(user, modelName, body.name);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'LANGUAGE_MODEL_NAME_CHANGED',
        resourceId: modelName,
        resourceType: 'LanguageModel',
        metadata: { displayName: updated.displayName },
      });

      return successResponse({ data: updated });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'モデル表示名の更新に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
