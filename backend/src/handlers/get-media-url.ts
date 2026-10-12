import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { getMediaUrl } from '../services/media-service.js';

/**
 * GET /sessions/{sessionId}/media-url
 *
 * Generates a CloudFront Signed URL for the session's media file.
 * - Validates JWT and extracts user
 * - Validates sessionId path parameter
 * - Checks session access (team-based)
 * - Looks up the session's media file path from DynamoDB
 * - Generates a CloudFront Signed URL
 * - Returns the signed URL with expiration time
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

    const result = await getMediaUrl(sessionId);
    return successResponse(result);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
