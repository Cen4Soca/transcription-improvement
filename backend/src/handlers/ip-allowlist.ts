/**
 * IP Allowlist Handlers
 *
 * Lambda handlers for managing IP allowlist entries.
 * All operations require ADMIN role.
 *
 * Endpoints:
 *   GET    /admin/ip-allowlist          - List all entries
 *   POST   /admin/ip-allowlist          - Add a new entry
 *   DELETE /admin/ip-allowlist/{entryId} - Delete an entry
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
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
 * Adds a new IP allowlist entry.
 * Validates CIDR format and enforces max 1,000 entries.
 * Records audit log and updates WAF IP set.
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
      throw validationError(
        'The CIDR block is required.',
        undefined,
        ERROR_CODES.CIDR_REQUIRED
      );
    }

    if (body.description !== undefined && typeof body.description !== 'string') {
      throw validationError(
        'Description must be a string.',
        undefined,
        ERROR_CODES.IP_ALLOWLIST_DESCRIPTION_INVALID
      );
    }

    const entry = await addEntry({
      cidr: body.cidr,
      description: body.description as string | undefined,
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
 * Deletes an IP allowlist entry by ID.
 * Records audit log and updates WAF IP set.
 *
 * Response:
 *   { data: { deleted: true } }
 */
export async function deleteIPAllowlistHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const entryId = event.pathParameters?.entryId;
    if (!entryId) {
      throw validationError(
        'The entry ID is required.',
        undefined,
        ERROR_CODES.IP_ENTRY_ID_REQUIRED
      );
    }

    await deleteEntry(entryId, user);

    return successResponse({ data: { deleted: true } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
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
    throw validationError(
      'The request body is not valid JSON.',
      undefined,
      ERROR_CODES.REQUEST_BODY_INVALID
    );
  }
}
