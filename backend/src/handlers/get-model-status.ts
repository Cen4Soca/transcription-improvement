import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { getModelStatus } from '../services/language-model-service.js';
import { checkLanguageModelAccess } from '../services/access-control-service.js';

/**
 * GET /language-models/{modelName}
 *
 * Retrieves the status of a specific custom language model.
 * - Validates JWT and extracts user (Admin/TeamLeader only)
 * - Extracts modelName from path parameters
 * - Enforces team isolation via checkLanguageModelAccess (ADMIN any team;
 *   others own-team only; 404 hides other-team/missing/PENDING models)
 * - Calls LanguageModelService.getModelStatus()
 * - Returns the model status
 *
 * Requirements: 6.7, 6.8
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Role check: Admin/TeamLeader only
    requireRole(user, 'TEAM_LEADER');

    // Extract modelName from path parameters
    const modelName = event.pathParameters?.modelName;
    if (!modelName) {
      throw validationError('modelName パスパラメータは必須です。');
    }

    // Team isolation: ADMIN any team; others own-team only.
    // 404s on missing/other-team/PENDING models to hide existence.
    await checkLanguageModelAccess(user, modelName);

    // Get model status
    const status = await getModelStatus(modelName);

    return successResponse(status);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
