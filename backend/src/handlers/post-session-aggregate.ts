/**
 * POST /sessions/{sessionId}/aggregate
 *
 * Manually aggregate a review session and mark it COMPLETED.
 *
 * Business context:
 * The automatic consensus flow only runs once the minimum number of reviewers
 * (default 3) have submitted corrections. This endpoint lets an ADMIN or
 * TEAM_LEADER force aggregation even when fewer reviewers have contributed, so a
 * session can be closed out without waiting for the full reviewer quorum.
 *
 * Behavior:
 * - ADMIN may aggregate any session; TEAM_LEADER only sessions in their own team.
 * - Aggregates every segment against the actual participant count.
 * - Segments meeting the threshold are CONFIRMED; the rest are marked CONFLICT.
 * - Auto-confirmed segments (confirmedBy = SYSTEM) are never overwritten.
 * - The session is transitioned to COMPLETED.
 * - Records a SESSION_MANUAL_AGGREGATED audit log.
 *
 * Response:
 *   { data: { sessionId, status, confirmedCount, conflictCount, totalReviewers } }
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser, isAdmin, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import {
  validationError,
  notFoundError,
  forbiddenError,
  internalError,
} from '../utils/error-handler.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import {
  getSessionById,
  updateSessionStatus,
  countParticipants,
} from '../repositories/session-repository.js';
import { isTeamMember } from '../services/access-control-service.js';
import {
  forceAggregateSegments,
  type SegmentCorrectionGroup,
} from '../services/consensus-service.js';
import { recordAuditLog } from '../services/audit-service.js';

interface SegmentItem {
  segmentId: string;
  pk: string;
  sk: string;
  consensusStatus: string;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    // Only ADMIN and TEAM_LEADER may force aggregation.
    requireRole(user, 'TEAM_LEADER');

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パスパラメータが必要です。');
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      throw notFoundError('指定されたセッションが見つかりません。');
    }

    // TEAM_LEADER is limited to their own team's sessions; ADMIN has no limit.
    if (!isAdmin(user)) {
      if (!session.assignedTeamId) {
        throw forbiddenError('このセッションを集計する権限がありません。');
      }
      const member = await isTeamMember(user.userId, session.assignedTeamId);
      if (!member) {
        throw forbiddenError('自チームのセッションのみ集計できます。');
      }
    }

    if (session.status === 'COMPLETED') {
      throw validationError('このセッションは既に完了しています。');
    }

    try {
      // Number of reviewers who actually participated in this session.
      const totalReviewers = await countParticipants(sessionId);

      // Load all segments and, for each, the corrections across every reviewer.
      const segments = await getSegments(sessionId);
      const groups: SegmentCorrectionGroup[] = await Promise.all(
        segments.map(async (segment) => ({
          segmentId: segment.segmentId,
          corrections: await getSegmentCorrections(segment.segmentId),
        }))
      );

      // Compute consensus for every segment against the actual reviewer count.
      const results = forceAggregateSegments(
        groups,
        session.consensusThreshold,
        totalReviewers
      );

      const now = new Date().toISOString();
      const segmentBySegmentId = new Map(
        segments.map((s) => [s.segmentId, s])
      );

      let confirmedCount = 0;
      let conflictCount = 0;

      for (const result of results) {
        const segment = segmentBySegmentId.get(result.segmentId);
        if (!segment) {
          continue;
        }

        // Never override an already auto-confirmed segment.
        if (segment.consensusStatus === 'CONFIRMED') {
          confirmedCount++;
          continue;
        }

        if (result.status === 'CONFIRMED' && result.consensusText !== undefined) {
          await saveManualConsensusResult(
            sessionId,
            result.segmentId,
            result.consensusText,
            user.userId,
            now
          );
          await updateSegmentStatus(
            segment.pk,
            segment.sk,
            'CONFIRMED',
            now,
            result.consensusText
          );
          confirmedCount++;
        } else {
          await updateSegmentStatus(segment.pk, segment.sk, 'CONFLICT', now);
          conflictCount++;
        }
      }

      // Close out the session.
      const updated = await updateSessionStatus(sessionId, 'COMPLETED');

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'SESSION_MANUAL_AGGREGATED',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: {
          totalReviewers: String(totalReviewers),
          confirmedCount: String(confirmedCount),
          conflictCount: String(conflictCount),
        },
      });

      return successResponse({
        data: {
          sessionId,
          status: updated.status,
          totalReviewers,
          confirmedCount,
          conflictCount,
        },
      });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'セッションの集計に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * Load all segments for a session (PK=SESSION#{sessionId}, SK begins_with SEGMENT#).
 */
async function getSegments(sessionId: string): Promise<SegmentItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'SEGMENT#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    segmentId: item['segmentId'] as string,
    pk: item['PK'] as string,
    sk: item['SK'] as string,
    consensusStatus: (item['consensusStatus'] as string) ?? 'UNDECIDED',
  }));
}

/**
 * Get the latest correction per reviewer for a segment, via GSI1=SEGMENT#{segmentId}.
 */
async function getSegmentCorrections(
  segmentId: string
): Promise<Array<{ userId: string; afterText: string }>> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `SEGMENT#${segmentId}`,
        ':prefix': 'CORRECTION#',
      },
      ScanIndexForward: true,
    })
  );

  // Deduplicate by userId — keep the latest correction per reviewer.
  const latestByUser = new Map<string, { userId: string; afterText: string }>();
  for (const item of result.Items ?? []) {
    const userId = item['userId'] as string;
    const afterText = item['afterText'] as string;
    latestByUser.set(userId, { userId, afterText });
  }

  return Array.from(latestByUser.values());
}

/**
 * Save a manually aggregated ConsensusResult.
 * Guarded so it never overwrites an auto-confirmed (SYSTEM) result.
 */
async function saveManualConsensusResult(
  sessionId: string,
  segmentId: string,
  consensusText: string,
  actorUserId: string,
  now: string
): Promise<void> {
  try {
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
          confirmedBy: actorUserId,
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression:
          'attribute_not_exists(PK) OR (attribute_exists(PK) AND confirmedBy <> :system)',
        ExpressionAttributeValues: {
          ':system': 'SYSTEM',
        },
      })
    );
  } catch (error: unknown) {
    // An auto-confirmed result already exists — leave it untouched.
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return;
    }
    throw error;
  }
}

/**
 * Update a segment's consensus status (and text when CONFIRMED).
 */
async function updateSegmentStatus(
  pk: string,
  sk: string,
  status: 'CONFIRMED' | 'CONFLICT',
  now: string,
  consensusText?: string
): Promise<void> {
  const updateExpression = consensusText
    ? 'SET consensusStatus = :status, consensusText = :text, updatedAt = :now'
    : 'SET consensusStatus = :status, updatedAt = :now';

  const values: Record<string, unknown> = {
    ':status': status,
    ':now': now,
  };
  if (consensusText) {
    values[':text'] = consensusText;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: values,
    })
  );
}
