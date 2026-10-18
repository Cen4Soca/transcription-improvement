/**
 * PATCH /admin/settings/consensus
 *
 * Admin-only endpoint to enable/disable partial aggregation for consensus.
 * When partial aggregation is enabled, consensus computation triggers
 * when ceil(N/2) reviewers have submitted (majority threshold), in addition
 * to the default trigger when all reviewers have submitted.
 *
 * Requirements: 10.3
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

interface ConsensusSettingsBody {
  partialAggregationEnabled: boolean;
}

/**
 * PATCH /admin/settings/consensus
 * Updates the consensus settings (partial aggregation toggle).
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const body = parseBody(event.body);

    await updateConsensusSettings(body.partialAggregationEnabled, user.userId);

    return successResponse({
      data: {
        partialAggregationEnabled: body.partialAggregationEnabled,
        updatedAt: new Date().toISOString(),
        updatedBy: user.userId,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * Parse and validate the request body.
 */
function parseBody(rawBody: string | undefined): ConsensusSettingsBody {
  if (!rawBody) {
    throw validationError('リクエストボディが必要です。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw validationError('リクエストボディのJSON形式が不正です。');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw validationError('リクエストボディはオブジェクトである必要があります。');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['partialAggregationEnabled'] !== 'boolean') {
    throw validationError(
      'partialAggregationEnabled は boolean 型で指定してください。'
    );
  }

  return {
    partialAggregationEnabled: obj['partialAggregationEnabled'] as boolean,
  };
}

/**
 * Update the consensus settings in DynamoDB.
 * Uses SETTINGS#CONSENSUS as the key for global consensus settings.
 */
async function updateConsensusSettings(
  partialAggregationEnabled: boolean,
  updatedBy: string
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: 'SETTINGS',
          SK: 'CONSENSUS',
        },
        UpdateExpression:
          'SET partialAggregationEnabled = :enabled, updatedAt = :now, updatedBy = :by, entityType = :et',
        ExpressionAttributeValues: {
          ':enabled': partialAggregationEnabled,
          ':now': now,
          ':by': updatedBy,
          ':et': 'ConsensusSettings',
        },
      })
    );
  } catch (error: unknown) {
    throw internalError(
      'Consensus 設定の更新に失敗しました。',
      error instanceof Error ? error.message : undefined
    );
  }
}

/**
 * Get current consensus settings from DynamoDB.
 * Exported for use by other handlers that need to check settings.
 */
export async function getConsensusSettings(): Promise<{
  partialAggregationEnabled: boolean;
}> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: 'SETTINGS',
        SK: 'CONSENSUS',
      },
    })
  );

  if (!result.Item) {
    return { partialAggregationEnabled: false };
  }

  return {
    partialAggregationEnabled:
      (result.Item['partialAggregationEnabled'] as boolean) ?? false,
  };
}
