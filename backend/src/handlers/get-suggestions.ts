import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
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
      throw validationError('sessionId パスパラメータが必要です。');
    }

    const segmentId = event.queryStringParameters?.segmentId;
    if (!segmentId) {
      throw validationError('segmentId クエリパラメータが必要です。');
    }

    const originalText = event.queryStringParameters?.text ?? '';

    await checkSessionAccess(user, sessionId);

    try {
      const result = await generateSuggestions(segmentId, originalText);
      return successResponse(result);
    } catch (error: unknown) {
      throw internalError(
        '修正候補の取得に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
