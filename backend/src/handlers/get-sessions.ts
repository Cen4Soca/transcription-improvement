import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { getAccessibleSessionIds } from '../services/access-control-service.js';
import {
  getAllSessions,
  getSessionsByIds,
  filterByStatus,
  sortByCreatedAtDesc,
  SESSION_PAGE_SIZE,
  type SessionRecord,
} from '../repositories/session-repository.js';
import type { PaginatedResponse } from '../types/index.js';

const VALID_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;

/**
 * GET /sessions
 *
 * Retrieves all ReviewSessions accessible to the authenticated user.
 * - ADMIN: all sessions
 * - TEAM_LEADER / REVIEWER: only sessions assigned to their teams or directly assigned
 *
 * Query parameters:
 *   - status (optional): Filter by session status (PENDING | IN_PROGRESS | COMPLETED)
 *   - page (optional): Page number (1-based), default 1
 *
 * Response:
 *   PaginatedResponse<SessionRecord>
 *
 * Sorted by createdAt descending.
 * Returns empty items array if no sessions found.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Validate status query parameter if provided
    const statusParam = event.queryStringParameters?.status;
    if (statusParam && !isValidStatus(statusParam)) {
      throw validationError(
        'status パラメータが不正です。PENDING, IN_PROGRESS, COMPLETED のいずれかを指定してください。'
      );
    }

    // Validate page query parameter
    const pageParam = event.queryStringParameters?.page;
    let page = 1;
    if (pageParam) {
      page = parseInt(pageParam, 10);
      if (isNaN(page) || page < 1) {
        throw validationError('page パラメータは1以上の整数で指定してください。');
      }
    }

    try {
      // Get accessible session IDs (null means ADMIN - all sessions)
      const accessibleIds = await getAccessibleSessionIds(user);

      let sessions: SessionRecord[];

      if (accessibleIds === null) {
        // ADMIN: get all sessions
        sessions = await getAllSessions();
      } else {
        // Non-ADMIN: get only accessible sessions
        if (accessibleIds.length === 0) {
          return successResponse(buildEmptyPaginatedResponse(page));
        }
        sessions = await getSessionsByIds(accessibleIds);
      }

      // Apply status filter if provided
      if (statusParam) {
        sessions = filterByStatus(sessions, statusParam);
      }

      // Sort by createdAt descending
      sessions = sortByCreatedAtDesc(sessions);

      // Apply pagination
      const totalItems = sessions.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / SESSION_PAGE_SIZE));
      const startIndex = (page - 1) * SESSION_PAGE_SIZE;
      const paginatedItems = sessions.slice(startIndex, startIndex + SESSION_PAGE_SIZE);

      const response: PaginatedResponse<SessionRecord> = {
        items: paginatedItems,
        pagination: {
          currentPage: page,
          pageSize: SESSION_PAGE_SIZE,
          totalItems,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };

      return successResponse(response);
    } catch (queryError: unknown) {
      throw internalError(
        'セッション一覧の取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function isValidStatus(status: string): status is (typeof VALID_STATUSES)[number] {
  return (VALID_STATUSES as readonly string[]).includes(status);
}

function buildEmptyPaginatedResponse(page: number): PaginatedResponse<SessionRecord> {
  return {
    items: [],
    pagination: {
      currentPage: page,
      pageSize: SESSION_PAGE_SIZE,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}
