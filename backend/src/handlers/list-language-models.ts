import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { listModels } from '../services/language-model-service.js';

/**
 * GET /language-models
 *
 * Lists available custom language models (COMPLETED status only).
 * - Validates JWT and extracts user
 * - Calls LanguageModelService.listModels()
 * - Returns the filtered model list
 *
 * Requirements: 6.7
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    // Validate user authentication
    const user = await extractUser(event);

    // Get list of completed language models visible to the caller
    const models = await listModels(user);

    return successResponse({ models });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
