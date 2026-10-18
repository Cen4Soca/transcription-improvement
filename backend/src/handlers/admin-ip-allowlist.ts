import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import {
  getAllEntries,
  addEntry,
  deleteEntry,
} from '../services/ip-allowlist-service.js';

/**
 * GET /admin/ip-allowlist
 *
 * Retrieves all IP allowlist entries. Admin only.
 *
 * Response:
 *   { data: IPAllowlistEntry[] }
 */
export async function listIPAllowlistHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const entries = await getAllEntries();
    return successResponse({ data: entries });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * POST /admin/ip-allowlist
 *
 * Adds a new IP allowlist entry with CIDR validation.
 * Enforces maximum 1,000 entries limit.
 * Updates WAF IP set for changes to propagate within 30 minutes.
 * Records the operation in audit log.
 *
 * Request body:
 *   { cidr: string, description?: string }
 *
 * Response:
 *   { data: IPAllowlistEntry }
 */
export async function addIPAllowlistHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const body = parseBody(event.body);

    if (!body.cidr || typeof body.cidr !== 'string') {
      throw validationError('CIDRブロックは必須です。');
    }

    const description =
      body.description !== undefined && typeof body.description === 'string'
        ? body.description
        : undefined;

    const entry = await addEntry({
      cidr: body.cidr,
      description,
      createdBy: user.userId,
      actor: user,
    });

    return successResponse({ data: entry }, 201);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * DELETE /admin/ip-allowlist/{entryId}
 *
 * Deletes an IP allowlist entry by entryId.
 * Updates WAF IP set for changes to propagate within 30 minutes.
 * When the last entry is removed, IP-based access restriction is disabled.
 * Records the operation in audit log.
 *
 * Response:
 *   { data: { message: string } }
 */
export async function deleteIPAllowlistHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const entryId = event.pathParameters?.entryId;
    if (!entryId) {
      throw validationError('エントリIDは必須です。');
    }

    await deleteEntry(entryId, user);

    return successResponse({ data: { message: 'IPアドレスエントリを削除しました。' } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

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
