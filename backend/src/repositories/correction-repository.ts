import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

export interface CorrectionRecord {
  correctionId: string;
  sessionId: string;
  segmentId: string;
  userId: string;
  correctionType: 'TEXT' | 'SPEAKER' | 'SPEAKER_RENAME';
  beforeText: string;
  afterText: string;
  beforeSpeaker?: string;
  afterSpeaker?: string;
  affectedSegmentCount?: number;
  createdAt: string;
}

export interface SaveCorrectionResult {
  saved: boolean;
  duplicate: boolean;
}

/**
 * Save a Correction to DynamoDB with idempotency check on correctionId.
 * Uses a condition expression to prevent duplicate saves.
 *
 * Key design:
 *   PK: SESSION#{sessionId}#USER#{userId}
 *   SK: CORRECTION#{createdAt}#{correctionId}
 *   GSI1PK: SEGMENT#{segmentId}
 *   GSI1SK: CORRECTION#{createdAt}
 */
export async function saveCorrection(
  record: CorrectionRecord
): Promise<SaveCorrectionResult> {
  const pk = `SESSION#${record.sessionId}#USER#${record.userId}`;
  const sk = `CORRECTION#${record.createdAt}#${record.correctionId}`;
  const gsi1pk = `SEGMENT#${record.segmentId}`;
  const gsi1sk = `CORRECTION#${record.createdAt}`;

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: pk,
          SK: sk,
          GSI1PK: gsi1pk,
          GSI1SK: gsi1sk,
          entityType: 'Correction',
          correctionId: record.correctionId,
          sessionId: record.sessionId,
          segmentId: record.segmentId,
          userId: record.userId,
          correctionType: record.correctionType,
          beforeText: record.beforeText,
          afterText: record.afterText,
          beforeSpeaker: record.beforeSpeaker,
          afterSpeaker: record.afterSpeaker,
          affectedSegmentCount: record.affectedSegmentCount,
          createdAt: record.createdAt,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      })
    );

    return { saved: true, duplicate: false };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return { saved: false, duplicate: true };
    }
    throw error;
  }
}

/**
 * Update ReviewSession status from PENDING to IN_PROGRESS.
 * Uses a condition expression to only update if current status is PENDING.
 * Silently succeeds if the session is already IN_PROGRESS or COMPLETED.
 */
export async function updateSessionStatusToInProgress(
  sessionId: string
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: 'METADATA',
        },
        UpdateExpression: 'SET #status = :newStatus, updatedAt = :now',
        ConditionExpression: '#status = :pendingStatus',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':newStatus': 'IN_PROGRESS',
          ':pendingStatus': 'PENDING',
          ':now': new Date().toISOString(),
        },
      })
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      // Session is already IN_PROGRESS or COMPLETED — no action needed
      return;
    }
    throw error;
  }
}

/**
 * Check if a user already has corrections for a session.
 * Used to determine if this is the first correction (to trigger status update).
 */
export async function hasExistingCorrections(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}#USER#${userId}`,
        ':prefix': 'CORRECTION#',
      },
      Limit: 1,
    })
  );

  return (result.Items?.length ?? 0) > 0;
}

/**
 * Get all corrections for a user in a session.
 * Queries by PK=SESSION#{sessionId}#USER#{userId} and SK begins_with CORRECTION#.
 * Results are sorted by SK ascending (chronological order since SK includes createdAt).
 */
export async function getCorrections(
  sessionId: string,
  userId: string
): Promise<CorrectionRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}#USER#${userId}`,
        ':prefix': 'CORRECTION#',
      },
      ScanIndexForward: true,
    })
  );

  return (result.Items ?? []).map((item) => ({
    correctionId: item['correctionId'] as string,
    sessionId: item['sessionId'] as string,
    segmentId: item['segmentId'] as string,
    userId: item['userId'] as string,
    correctionType: item['correctionType'] as CorrectionRecord['correctionType'],
    beforeText: item['beforeText'] as string,
    afterText: item['afterText'] as string,
    beforeSpeaker: item['beforeSpeaker'] as string | undefined,
    afterSpeaker: item['afterSpeaker'] as string | undefined,
    affectedSegmentCount: item['affectedSegmentCount'] as number | undefined,
    createdAt: item['createdAt'] as string,
  }));
}
