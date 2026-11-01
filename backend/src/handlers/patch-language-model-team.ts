import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { changeModelTeam } from '../services/language-model-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * PATCH /language-models/{modelName}/team
 *
 * Re-assigns a custom language model to a different team (ADMIN only).
 * - Validates JWT and extracts user
 * - Validates the modelName path parameter
 * - Validates request body (teamId: non-empty string)
 * - Delegates ADMIN-only role check, target-team-exists validation, and
 *   destination displayName collision rejection to the service
 *   (changeModelTeam), which also rewrites GSI1PK/GSI2PK
 * - Records a LANGUAGE_MODEL_TEAM_CHANGED audit log (old -> new teamId)
 * - Returns the updated model metadata
 *
 * Request body:
 *   { "teamId": string }
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
    if (!body || !body.teamId || typeof body.teamId !== 'string') {
      throw validationError(
        'The request body must include a teamId field.',
        undefined,
        ERROR_CODES.TEAM_ID_FIELD_REQUIRED
      );
    }

    try {
      const updated = await changeModelTeam(user, modelName, body.teamId);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'LANGUAGE_MODEL_TEAM_CHANGED',
        resourceId: modelName,
        resourceType: 'LanguageModel',
        metadata: {
          oldTeamId: updated.oldTeamId,
          newTeamId: updated.newTeamId,
        },
      });

      return successResponse({ data: updated });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'Failed to change the model team.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.MODEL_TEAM_UPDATE_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
