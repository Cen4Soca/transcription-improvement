import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { internalError } from '../utils/error-handler.js';
import { listJoinableSessions } from '../services/session-service.js';

/**
 * GET /sessions/joinable
 *
 * Returns PENDING sessions assigned to one of the caller's teams that the
 * caller has not yet joined — the candidates a reviewer can self-assign to.
 * - Any authenticated user may call this; scope is derived from DB team membership.
 * - ADMIN sees all PENDING sessions they have not joined.
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
      const items = await listJoinableSessions(user);
      return successResponse({ data: { items } });
    } catch (queryError: unknown) {
      // Let an AppError propagate with its own status instead of being
      // swallowed into a 500. Harmless today (listJoinableSessions throws only
      // raw DynamoDB errors) but guards against regressions.
      if (queryError instanceof Error && 'statusCode' in queryError) {
        throw queryError;
      }
      throw internalError(
        '参加可能なセッションの取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
