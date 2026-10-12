/**
 * Audit Log Handlers
 *
 * Lambda handlers for GET/DELETE /admin/audit-logs.
 * All operations require ADMIN role.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import {
  searchAuditLogs,
  removeAuditLogs,
  type AuditOperationType,
} from '../services/audit-service.js';

const VALID_OPERATION_TYPES: AuditOperationType[] = [
  'IP_ALLOWLIST_CHANGE',
  'USER_MANAGEMENT',
  'TEAM_MANAGEMENT',
  'REVIEW_ASSIGNMENT_CHANGE',
  'TEAM_ASSIGNMENT_CHANGE',
  'SESSION_COMPLETED',
  'CONSENSUS_MANUAL_CONFIRM',
  'CORRECTION_CONFIRMED',
  'SPEAKER_LABEL_CHANGED',
  'LOGIN_FAILURE',
  'MEDIA_DELETED',
  'TRANSCRIPTION_DELETED',
  'PARTIAL_DELETION_FAILURE',
  'LANGUAGE_MODEL_CREATED',
  'AUDIT_LOG_DELETED',
];

/**
 * GET /admin/audit-logs
 *
 * Retrieves audit log entries with optional filters and pagination.
 * Admin only.
 *
 * Query parameters:
 *   - startDate: ISO 8601 date string (optional)
 *   - endDate: ISO 8601 date string (optional)
 *   - actorUserId: Filter by actor user ID (optional)
 *   - operationType: Filter by operation type (optional)
 *   - page: Page number, default 1 (optional)
 *
 * Response:
 *   {
 *     data: AuditLogRecord[],
 *     pagination: { page, pageSize, totalCount, totalPages }
 *   }
 */
export async function listAuditLogsHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const queryParams = event.queryStringParameters ?? {};

    const startDate = queryParams['startDate'];
    const endDate = queryParams['endDate'];
    const actorUserId = queryParams['actorUserId'];
    const operationType = queryParams['operationType'];
    const pageStr = queryParams['page'];

    // Validate operationType if provided
    if (operationType && !isValidOperationType(operationType)) {
      throw validationError(
        '無効な操作種別です。',
        `Valid values: ${VALID_OPERATION_TYPES.join(', ')}`
      );
    }

    // Validate page number
    let page = 1;
    if (pageStr) {
      page = parseInt(pageStr, 10);
      if (isNaN(page) || page < 1) {
        throw validationError('ページ番号は1以上の整数で指定してください。');
      }
    }

    // Validate date formats
    if (startDate && !isValidISODate(startDate)) {
      throw validationError('開始日はISO 8601形式で指定してください。');
    }
    if (endDate && !isValidISODate(endDate)) {
      throw validationError('終了日はISO 8601形式で指定してください。');
    }

    const result = await searchAuditLogs({
      startDate,
      endDate,
      actorUserId,
      operationType: operationType as AuditOperationType | undefined,
      page,
    });

    return successResponse({
      data: result.items,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * DELETE /admin/audit-logs
 *
 * Deletes audit log entries matching the given filter criteria.
 * Admin only.
 *
 * Request body:
 *   {
 *     startDate?: string,
 *     endDate?: string,
 *     actorUserId?: string,
 *     operationType?: string
 *   }
 *
 * At least one filter must be provided.
 *
 * Response:
 *   { data: { deletedCount: number } }
 */
export async function deleteAuditLogsHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const body = parseBody(event.body);

    const startDate = body['startDate'] as string | undefined;
    const endDate = body['endDate'] as string | undefined;
    const actorUserId = body['actorUserId'] as string | undefined;
    const operationType = body['operationType'] as string | undefined;

    // Require at least one filter
    if (!startDate && !endDate && !actorUserId && !operationType) {
      throw validationError(
        '削除条件を少なくとも1つ指定してください（期間・実行者・操作種別）。'
      );
    }

    // Validate operationType if provided
    if (operationType && !isValidOperationType(operationType)) {
      throw validationError(
        '無効な操作種別です。',
        `Valid values: ${VALID_OPERATION_TYPES.join(', ')}`
      );
    }

    // Validate date formats
    if (startDate && !isValidISODate(startDate)) {
      throw validationError('開始日はISO 8601形式で指定してください。');
    }
    if (endDate && !isValidISODate(endDate)) {
      throw validationError('終了日はISO 8601形式で指定してください。');
    }

    const deletedCount = await removeAuditLogs(
      {
        startDate,
        endDate,
        actorUserId,
        operationType: operationType as AuditOperationType | undefined,
      },
      { userId: user.userId, role: user.role }
    );

    return successResponse({ data: { deletedCount } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * Validate that a string is a valid AuditOperationType.
 */
function isValidOperationType(value: string): value is AuditOperationType {
  return VALID_OPERATION_TYPES.includes(value as AuditOperationType);
}

/**
 * Validate that a string is a valid ISO 8601 date.
 */
function isValidISODate(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Parse JSON body from event.
 */
function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw validationError('リクエストボディのJSON形式が不正です。');
  }
}
