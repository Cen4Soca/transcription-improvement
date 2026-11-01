/**
 * GET /admin/settings/ranking
 * PATCH /admin/settings/ranking
 *
 * Admin-only endpoints to manage ranking display settings.
 * Controls the display scope of the ContributorRanking:
 *   - ALL_USERS: Show all users
 *   - TEAM_ONLY: Show only users within the same team
 *   - TOP_N: Show only the top N users
 *
 * Requirements: 12.12
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import type { RankingDisplayScope, RankingSettings } from '../types/index.js';

const VALID_DISPLAY_SCOPES: RankingDisplayScope[] = ['ALL_USERS', 'TEAM_ONLY', 'TOP_N'];

/**
 * GET /admin/settings/ranking
 * Retrieves the current ranking display settings.
 */
export async function getHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    try {
      const settings = await getRankingSettings();
      return successResponse({ data: settings });
    } catch (queryError: unknown) {
      throw internalError(
        'Failed to retrieve the ranking settings.',
        queryError instanceof Error ? queryError.message : undefined,
        ERROR_CODES.RANKING_SETTINGS_FETCH_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * PATCH /admin/settings/ranking
 * Updates the ranking display settings.
 */
export async function patchHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const body = parseBody(event.body);

    try {
      const now = new Date().toISOString();

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: 'SETTINGS',
            SK: 'RANKING',
          },
          UpdateExpression:
            'SET displayScope = :scope, topN = :topN, updatedAt = :now, updatedBy = :by, entityType = :et',
          ExpressionAttributeValues: {
            ':scope': body.displayScope,
            ':topN': body.topN ?? null,
            ':now': now,
            ':by': user.userId,
            ':et': 'RankingSettings',
          },
        })
      );

      const settings: RankingSettings = {
        displayScope: body.displayScope,
        topN: body.topN,
        updatedAt: now,
        updatedBy: user.userId,
      };

      return successResponse({ data: settings });
    } catch (updateError: unknown) {
      throw internalError(
        'Failed to update the ranking settings.',
        updateError instanceof Error ? updateError.message : undefined,
        ERROR_CODES.RANKING_SETTINGS_UPDATE_FAILED
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * Get current ranking settings from DynamoDB.
 * Returns default settings if none exist.
 */
export async function getRankingSettings(): Promise<RankingSettings> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: 'SETTINGS',
        SK: 'RANKING',
      },
    })
  );

  if (!result.Item) {
    return {
      displayScope: 'ALL_USERS',
      topN: undefined,
      updatedAt: '',
      updatedBy: '',
    };
  }

  return {
    displayScope: (result.Item['displayScope'] as RankingDisplayScope) ?? 'ALL_USERS',
    topN: result.Item['topN'] as number | undefined,
    updatedAt: (result.Item['updatedAt'] as string) ?? '',
    updatedBy: (result.Item['updatedBy'] as string) ?? '',
  };
}

/**
 * Parse and validate the request body for PATCH.
 */
function parseBody(rawBody: string | undefined): { displayScope: RankingDisplayScope; topN?: number } {
  if (!rawBody) {
    throw validationError(
      'A request body is required.',
      undefined,
      ERROR_CODES.REQUEST_BODY_REQUIRED
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw validationError(
      'The request body is not valid JSON.',
      undefined,
      ERROR_CODES.REQUEST_BODY_INVALID
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw validationError(
      'The request body must be an object.',
      undefined,
      ERROR_CODES.REQUEST_BODY_NOT_OBJECT
    );
  }

  const obj = parsed as Record<string, unknown>;

  const displayScope = obj['displayScope'];
  if (typeof displayScope !== 'string' || !isValidDisplayScope(displayScope)) {
    throw validationError(
      'displayScope must be one of ALL_USERS, TEAM_ONLY, or TOP_N.',
      undefined,
      ERROR_CODES.RANKING_DISPLAY_SCOPE_INVALID
    );
  }

  let topN: number | undefined;
  if (displayScope === 'TOP_N') {
    if (typeof obj['topN'] !== 'number' || obj['topN'] < 1 || !Number.isInteger(obj['topN'])) {
      throw validationError(
        'When displayScope is TOP_N, topN must be an integer of at least 1.',
        undefined,
        ERROR_CODES.RANKING_TOP_N_INVALID
      );
    }
    topN = obj['topN'] as number;
  }

  return { displayScope: displayScope as RankingDisplayScope, topN };
}

function isValidDisplayScope(scope: string): scope is RankingDisplayScope {
  return (VALID_DISPLAY_SCOPES as string[]).includes(scope);
}
