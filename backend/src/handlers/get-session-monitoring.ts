import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { AppError, validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { isValidStatus } from '../services/session-service.js';
import {
  listSessionMonitoring,
  type SessionMonitoringFilters,
} from '../services/monitoring-service.js';

/**
 * GET /sessions/monitoring
 *
 * Assignment / status overview of sessions for ADMIN and TEAM_LEADER.
 * - ADMIN: all sessions. TEAM_LEADER: sessions assigned to their own teams.
 * - REVIEWER: 403.
 *
 * Query parameters (all optional):
 *   status (PENDING | IN_PROGRESS | COMPLETED), teamId, userId,
 *   unassignedOnly (true | false), stalledOnly (true | false), page (>= 1)
 *
 * Response:
 *   { data: { items: MonitoringSessionItem[], pagination } }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const query = event.queryStringParameters ?? {};

    const filters: SessionMonitoringFilters = {};

    if (query['status']) {
      if (!isValidStatus(query['status'])) {
        throw invalidFilter('The status parameter is invalid.');
      }
      filters.status = query['status'];
    }
    if (query['teamId']) {
      filters.teamId = query['teamId'];
    }
    if (query['userId']) {
      filters.userId = query['userId'];
    }
    if (query['unassignedOnly'] !== undefined) {
      filters.unassignedOnly = parseBoolean(query['unassignedOnly'], 'unassignedOnly');
    }
    if (query['stalledOnly'] !== undefined) {
      filters.stalledOnly = parseBoolean(query['stalledOnly'], 'stalledOnly');
    }

    let page = 1;
    if (query['page']) {
      page = Number(query['page']);
      if (!Number.isInteger(page) || page < 1) {
        throw validationError(
          'The page parameter must be an integer of at least 1.',
          undefined,
          ERROR_CODES.PAGE_NUMBER_INVALID
        );
      }
    }

    try {
      const result = await listSessionMonitoring(user, filters, page);
      return successResponse({ data: result });
    } catch (serviceError: unknown) {
      if (serviceError instanceof AppError) {
        throw serviceError;
      }
      throw internalError(
        'Failed to retrieve session monitoring data.',
        serviceError instanceof Error ? serviceError.message : undefined,
        ERROR_CODES.MONITORING_SESSIONS_FETCH_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function invalidFilter(message: string): AppError {
  return validationError(message, undefined, ERROR_CODES.MONITORING_FILTER_INVALID);
}

function parseBoolean(value: string, name: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw invalidFilter(`The ${name} parameter must be "true" or "false".`);
}
