import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
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
      throw validationError(
        'The modelName path parameter is required.',
        undefined,
        ERROR_CODES.MODEL_NAME_REQUIRED_PARAM
      );
    }

    const body = event.body ? JSON.parse(event.body) : null;
    if (!body || !body.name || typeof body.name !== 'string') {
      throw validationError(
        'The request body must include a name field.',
        undefined,
        ERROR_CODES.MODEL_NAME_FIELD_REQUIRED
      );
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
        'Failed to update the model display name.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.MODEL_DISPLAY_NAME_UPDATE_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
