import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { generateSuggestions } from '../services/suggestion-service.js';

/**
 * GET /sessions/{sessionId}/suggestions?segmentId=xxx&text=yyy
 *
 * Retrieves suggestion candidates for a specific segment.
 * Combines CorrectionHistory, Bedrock (Claude), and Comprehend results.
 *
 * - Validates JWT and extracts user
 * - Validates sessionId path parameter and segmentId query parameter
 * - Checks session access (team-based)
 * - Generates suggestions via suggestion service
 * - Returns max 5 candidates with source information
 * - On external API failure, returns history candidates + error flag
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

    const segmentId = event.queryStringParameters?.segmentId;
    if (!segmentId) {
      throw validationError(
        'The segmentId query parameter is required.',
        undefined,
        ERROR_CODES.SEGMENT_ID_REQUIRED
      );
    }

    const originalText = event.queryStringParameters?.text ?? '';

    await checkSessionAccess(user, sessionId);

    try {
      const result = await generateSuggestions(sessionId, segmentId, originalText);
      return successResponse(result);
    } catch (error: unknown) {
      throw internalError(
        'Failed to retrieve correction suggestions.',
        error instanceof Error ? error.message : undefined,
        ERROR_CODES.SUGGESTIONS_FETCH_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
