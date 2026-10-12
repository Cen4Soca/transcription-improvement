import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { internalError } from '../utils/error-handler.js';
import { getAssignedSessions } from '../services/session-service.js';

/**
 * GET /sessions/assigned
 *
 * Returns the sessions assigned to the authenticated user (their own workload).
 * - Any authenticated user may call this; it always scopes to the caller.
 * - Sorted by createdAt descending.
 *
 * Response:
 *   { data: { items: SessionRecord[] } }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    try {
      const items = await getAssignedSessions(user.userId);
      return successResponse({ data: { items } });
    } catch (queryError: unknown) {
      throw internalError(
        '割り当てセッションの取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
