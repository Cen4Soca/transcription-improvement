import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { AppError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { listUserWorkload } from '../services/monitoring-service.js';

/**
 * GET /monitoring/users
 *
 * Per-user workload counts (assigned / in progress / stalled) for ADMIN and
 * TEAM_LEADER.
 * - ADMIN: all users. TEAM_LEADER: members of their own teams only.
 * - REVIEWER: 403.
 *
 * Response:
 *   { data: { items: UserWorkloadItem[] } }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    try {
      const items = await listUserWorkload(user);
      return successResponse({ data: { items } });
    } catch (serviceError: unknown) {
      if (serviceError instanceof AppError) {
        throw serviceError;
      }
      throw internalError(
        'Failed to retrieve user workload.',
        serviceError instanceof Error ? serviceError.message : undefined,
        ERROR_CODES.USER_WORKLOAD_FETCH_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
