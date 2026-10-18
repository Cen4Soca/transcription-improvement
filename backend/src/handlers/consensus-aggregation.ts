/**
 * EventBridge-triggered Lambda handler for consensus aggregation.
 *
 * Triggered by CorrectionConfirmed events. Computes consensus when:
 * 1. All assigned reviewers have submitted corrections for a segment
 * 2. Partial aggregation is enabled AND majority (ceil(N/2)) have submitted
 *
 * On consensus:
 * - Saves ConsensusResult (if threshold met)
 * - Marks segment as CONFLICT and notifies Admin (if threshold not met)
 */

import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import {
  computeConsensus,
  shouldTriggerPartialAggregation,
  MIN_REVIEWERS_FOR_AUTO_CONSENSUS,
} from '../services/consensus-service.js';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const eventBridgeClient = new EventBridgeClient({ region: REGION });

export interface CorrectionConfirmedEvent {
  source: string;
  'detail-type': string;
  detail: {
    sessionId: string;
    segmentId: string;
    userId: string;
    correctionId: string;
  };
}

interface SessionMetadata {
  sessionId: string;
  assignedReviewerCount: number;
  consensusThreshold: number;
  partialAggregationEnabled: boolean;
}

interface SegmentCorrection {
  userId: string;
  afterText: string;
}

/**
 * Main handler for the CorrectionConfirmed EventBridge event.
 */
export async function handler(event: CorrectionConfirmedEvent): Promise<void> {
  const { sessionId, segmentId } = event.detail;

  // 1. Get session metadata (reviewer count, threshold, partial aggregation setting)
  const session = await getSessionMetadata(sessionId);
  if (!session) {
    console.error(`セッションが見つかりません: ${sessionId}`);
    return;
  }

  // 2. Get all corrections for this segment across all reviewers
  const corrections = await getSegmentCorrections(segmentId);

  // 3. Determine if aggregation should proceed
  const uniqueReviewers = new Set(corrections.map((c) => c.userId));
  const completedCount = uniqueReviewers.size;
  const allCompleted = completedCount >= session.assignedReviewerCount;

  // Business rule: automatic consensus requires a minimum number of reviewers.
  // Below that, aggregation is deferred to an explicit ADMIN / TEAM_LEADER
  // action (POST /sessions/{sessionId}/aggregate).
  // Configurable via the MIN_REVIEWERS_FOR_AUTO_CONSENSUS env var; falls back to
  // the imported constant when unset or invalid.
  const parsedMinReviewers = Number(process.env.MIN_REVIEWERS_FOR_AUTO_CONSENSUS);
  const minReviewers =
    Number.isInteger(parsedMinReviewers) && parsedMinReviewers >= 1
      ? parsedMinReviewers
      : MIN_REVIEWERS_FOR_AUTO_CONSENSUS;
  if (session.assignedReviewerCount < minReviewers) {
    return;
  }

  if (!allCompleted) {
    // Check if partial aggregation should trigger
    const shouldPartialTrigger = shouldTriggerPartialAggregation({
      completedCount,
      totalReviewers: session.assignedReviewerCount,
      partialAggregationEnabled: session.partialAggregationEnabled,
    });

    if (!shouldPartialTrigger) {
      // Not enough reviewers yet — wait
      return;
    }
  }

  // 4. Compute consensus
  const result = computeConsensus({
    corrections,
    threshold: session.consensusThreshold,
    totalReviewers: session.assignedReviewerCount,
  });

  if (result.status === 'CONFIRMED') {
    // 5a. Save ConsensusResult and update segment status
    await saveConsensusResult(sessionId, segmentId, result.consensusText!);
    await updateSegmentConsensusStatus(sessionId, segmentId, 'CONFIRMED', result.consensusText!);
    await emitConsensusResultConfirmedEvent(sessionId, segmentId, result.consensusText!);
  } else if (allCompleted) {
    // 5b. Mark segment as CONFLICT only when ALL reviewers have submitted
    // (partial aggregation that doesn't meet threshold just waits for more answers)
    await updateSegmentConsensusStatus(sessionId, segmentId, 'CONFLICT');
    await notifyAdminConflict(sessionId, segmentId);
  }
  // If partial aggregation didn't meet threshold and not all reviewers done, do nothing
}

/**
 * Retrieve session metadata from DynamoDB.
 */
async function getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':sk': 'METADATA',
      },
      Limit: 1,
    })
  );

  const item = result.Items?.[0];
  if (!item) {
    return null;
  }

  return {
    sessionId: item['sessionId'] as string,
    assignedReviewerCount: item['assignedReviewerCount'] as number,
    consensusThreshold: item['consensusThreshold'] as number,
    partialAggregationEnabled: (item['partialAggregationEnabled'] as boolean) ?? false,
  };
}

/**
 * Get all corrections for a specific segment across all reviewers.
 * Uses GSI1 with PK=SEGMENT#{segmentId} to find all corrections.
 *
 * Note: Only returns the latest correction per reviewer for the segment
 * (deduplicates by userId, keeping the most recent).
 */
async function getSegmentCorrections(segmentId: string): Promise<SegmentCorrection[]> {
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

  // Deduplicate by userId — keep the latest correction per reviewer
  const latestByUser = new Map<string, SegmentCorrection>();
  for (const item of result.Items ?? []) {
    const userId = item['userId'] as string;
    const afterText = item['afterText'] as string;
    latestByUser.set(userId, { userId, afterText });
  }

  return Array.from(latestByUser.values());
}

/**
 * Save ConsensusResult to DynamoDB.
 *
 * Key: PK=SESSION#{sessionId}, SK=CONSENSUS#{segmentId}
 *
 * Uses a condition expression to prevent overwriting an existing
 * confirmed result (requirement 10.5: Admin cannot change auto-confirmed results).
 */
async function saveConsensusResult(
  sessionId: string,
  segmentId: string,
  consensusText: string
): Promise<void> {
  const now = new Date().toISOString();

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
        confirmedBy: 'SYSTEM',
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );
}

/**
 * Update segment consensus status in DynamoDB.
 */
async function updateSegmentConsensusStatus(
  sessionId: string,
  segmentId: string,
  status: 'CONFIRMED' | 'CONFLICT',
  consensusText?: string
): Promise<void> {
  const updateExpression = consensusText
    ? 'SET consensusStatus = :status, consensusText = :text, updatedAt = :now'
    : 'SET consensusStatus = :status, updatedAt = :now';

  const expressionAttributeValues: Record<string, unknown> = {
    ':status': status,
    ':now': new Date().toISOString(),
  };

  if (consensusText) {
    expressionAttributeValues[':text'] = consensusText;
  }

  // Find the segment's SK (we need to query for it since SK includes startTime)
  const segmentResult = await docClient.send(
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

  const segmentItem = segmentResult.Items?.[0];
  if (!segmentItem) {
    console.error(`セグメントが見つかりません: ${segmentId}`);
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: segmentItem['PK'] as string,
        SK: segmentItem['SK'] as string,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

/**
 * Emit ConsensusResultConfirmed event to EventBridge.
 * This triggers downstream processing (e.g., ContributorScore update).
 */
async function emitConsensusResultConfirmedEvent(
  sessionId: string,
  segmentId: string,
  consensusText: string
): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'transcription-review-app',
          DetailType: 'ConsensusResultConfirmed',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            sessionId,
            segmentId,
            consensusText,
            confirmedAt: new Date().toISOString(),
          }),
        },
      ],
    })
  );
}

/**
 * Notify Admin about a conflict that requires manual resolution.
 * Emits a ConflictDetected event to EventBridge for Admin notification.
 */
async function notifyAdminConflict(
  sessionId: string,
  segmentId: string
): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'transcription-review-app',
          DetailType: 'ConflictDetected',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            sessionId,
            segmentId,
            detectedAt: new Date().toISOString(),
          }),
        },
      ],
    })
  );
}
