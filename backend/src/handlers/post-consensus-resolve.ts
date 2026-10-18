/**
 * POST /consensus/{sessionId}/resolve
 *
 * Admin-only endpoint for manual conflict resolution.
 * Saves ConsensusResult with confirmedBy = admin userId.
 * Only allowed for CONFLICT status segments (not auto-confirmed ones per Req 10.5).
 *
 * Request body: { segmentId: string, selectedText: string }
 *
 * Requirements: 10.8
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, notFoundError, internalError } from '../utils/error-handler.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import { getSessionById } from '../repositories/session-repository.js';
import { assertSessionEditable } from '../utils/session-guard.js';

interface ResolveRequestBody {
  segmentId: string;
  selectedText: string;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パラメータが必要です。');
    }

    // Parse and validate request body
    const body = parseRequestBody(event.body);

    try {
      // A COMPLETED session is confirmed and must not accept conflict resolution.
      const session = await getSessionById(sessionId);
      if (!session) {
        throw notFoundError('指定されたセッションが見つかりません。');
      }
      assertSessionEditable(session);

      // Verify segment exists and is in CONFLICT status
      const segment = await getSegment(sessionId, body.segmentId);
      if (!segment) {
        throw notFoundError('セグメントが見つかりません。');
      }

      if (segment.consensusStatus !== 'CONFLICT') {
        throw validationError(
          '競合解決は「競合解決待ち」状態のセグメントのみに対して実行できます。',
          `Current status: ${segment.consensusStatus}`
        );
      }

      // Save ConsensusResult with admin as confirmedBy
      const now = new Date().toISOString();
      await saveManualConsensusResult(sessionId, body.segmentId, body.selectedText, user.userId, now);

      // Update segment status to CONFIRMED
      await updateSegmentStatus(segment.pk, segment.sk, body.selectedText, now);

      return successResponse(
        {
          data: {
            sessionId,
            segmentId: body.segmentId,
            consensusText: body.selectedText,
            confirmedBy: user.userId,
            confirmedAt: now,
          },
        },
        200
      );
    } catch (error: unknown) {
      // Re-throw AppErrors (validation, not found)
      if (error && typeof error === 'object' && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        '競合解決の保存に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function parseRequestBody(body: string | undefined): ResolveRequestBody {
  if (!body) {
    throw validationError('リクエストボディが必要です。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw validationError('リクエストボディのJSON形式が不正です。');
  }

  const { segmentId, selectedText } = parsed as Record<string, unknown>;

  if (!segmentId || typeof segmentId !== 'string') {
    throw validationError('segmentId は必須の文字列パラメータです。');
  }

  if (selectedText === undefined || selectedText === null || typeof selectedText !== 'string') {
    throw validationError('selectedText は必須の文字列パラメータです。');
  }

  return { segmentId, selectedText };
}

interface SegmentRecord {
  pk: string;
  sk: string;
  consensusStatus: string;
}

/**
 * Get a segment by sessionId and segmentId.
 * Returns the segment record with its PK/SK for subsequent updates.
 */
async function getSegment(sessionId: string, segmentId: string): Promise<SegmentRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'segmentId = :segmentId',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'SEGMENT#',
        ':segmentId': segmentId,
      },
    })
  );

  const item = result.Items?.[0];
  if (!item) {
    return null;
  }

  return {
    pk: item['PK'] as string,
    sk: item['SK'] as string,
    consensusStatus: (item['consensusStatus'] as string) ?? 'UNDECIDED',
  };
}

/**
 * Save manual ConsensusResult to DynamoDB.
 * Uses a condition to prevent overwriting auto-confirmed results (Req 10.5).
 */
async function saveManualConsensusResult(
  sessionId: string,
  segmentId: string,
  consensusText: string,
  adminUserId: string,
  now: string
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: `CONSENSUS#${segmentId}`,
        entityType: 'ConsensusResult',
        sessionId,
        segmentId,
        consensusText,
        status: 'CONFIRMED',
        confirmedAt: now,
        confirmedBy: adminUserId,
        createdAt: now,
        updatedAt: now,
      },
      // Only allow writing if no auto-confirmed result exists
      // (CONFLICT segments won't have a SYSTEM-confirmed result)
      ConditionExpression:
        'attribute_not_exists(PK) OR (attribute_exists(PK) AND confirmedBy <> :system)',
      ExpressionAttributeValues: {
        ':system': 'SYSTEM',
      },
    })
  );
}

/**
 * Update segment consensus status to CONFIRMED after manual resolution.
 */
async function updateSegmentStatus(
  pk: string,
  sk: string,
  consensusText: string,
  now: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression:
        'SET consensusStatus = :status, consensusText = :text, updatedAt = :now',
      ExpressionAttributeValues: {
        ':status': 'CONFIRMED',
        ':text': consensusText,
        ':now': now,
      },
    })
  );
}
