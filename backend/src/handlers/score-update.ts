/**
 * EventBridge-triggered Lambda handler for ContributorScore updates.
 *
 * Triggered by ConsensusResultConfirmed events. When a consensus result
 * is confirmed for a segment, this handler:
 * 1. Retrieves all corrections for that segment
 * 2. Determines if each reviewer's answer matches the consensus
 * 3. Updates each reviewer's ContributorScore in DynamoDB for all periods
 *
 * DynamoDB key structure for ContributorScore:
 *   PK: RANKING#{period}
 *   SK: SCORE#{score_inverted}#{userId}
 *   GSI1PK: USER#{userId}
 *   GSI1SK: RANKING#{period}
 */

import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import {
  ALL_PERIODS,
  calculateScore,
  getPeriodStartDate,
  invertScoreForSortKey,
  type ScorePeriod,
} from '../services/score-service.js';

export interface ConsensusResultConfirmedEvent {
  source: string;
  'detail-type': string;
  detail: {
    sessionId: string;
    segmentId: string;
    consensusText: string;
    confirmedAt: string;
  };
}

interface SegmentCorrection {
  userId: string;
  afterText: string;
  createdAt: string;
}

interface UserScoreData {
  userId: string;
  displayName: string;
  totalAnswers: number;
  correctAnswers: number;
}

/**
 * Main handler for the ConsensusResultConfirmed EventBridge event.
 */
export async function handler(event: ConsensusResultConfirmedEvent): Promise<void> {
  const { segmentId } = event.detail;

  // 1. Get all corrections for this segment
  const corrections = await getSegmentCorrections(segmentId);

  if (corrections.length === 0) {
    console.warn(`No corrections found for segment: ${segmentId}`);
    return;
  }

  // 2. Get unique reviewer IDs
  const reviewerIds = [...new Set(corrections.map((c) => c.userId))];

  // 3. For each reviewer, update their score across all periods
  for (const userId of reviewerIds) {
    await updateReviewerScore(userId);
  }
}

/**
 * Get all corrections for a specific segment across all reviewers.
 * Uses GSI1 with PK=SEGMENT#{segmentId}.
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

  return (result.Items ?? []).map((item) => ({
    userId: item['userId'] as string,
    afterText: item['afterText'] as string,
    createdAt: item['createdAt'] as string,
  }));
}

/**
 * Update a reviewer's ContributorScore for all periods.
 *
 * For each period:
 * 1. Query all confirmed consensus results within the period
 * 2. For each confirmed segment, check if the reviewer's answer matches
 * 3. Calculate answerCount, accuracyRate, and score
 * 4. Delete old ranking entry and write new one
 */
async function updateReviewerScore(userId: string): Promise<void> {
  const now = new Date();

  // Get user display name
  const displayName = await getUserDisplayName(userId);

  for (const period of ALL_PERIODS) {
    const scoreData = await computeUserScoreForPeriod(userId, period, now);

    const accuracyRate =
      scoreData.totalAnswers > 0
        ? (scoreData.correctAnswers / scoreData.totalAnswers) * 100
        : 0;

    const score = calculateScore(scoreData.totalAnswers, accuracyRate);

    // Delete existing ranking entry for this user/period
    await deleteExistingRankingEntry(userId, period);

    // Write new ranking entry
    const invertedScore = invertScoreForSortKey(score);
    const nowIso = now.toISOString();

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `RANKING#${period}`,
          SK: `SCORE#${invertedScore}#${userId}`,
          GSI1PK: `USER#${userId}`,
          GSI1SK: `RANKING#${period}`,
          entityType: 'ContributorScore',
          userId,
          displayName,
          period,
          answerCount: scoreData.totalAnswers,
          accuracyRate,
          score,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      })
    );
  }
}

/**
 * Compute a user's score data for a specific period.
 *
 * Queries all confirmed ConsensusResults, filters by period,
 * then checks the user's corrections against each consensus.
 */
async function computeUserScoreForPeriod(
  userId: string,
  period: ScorePeriod,
  now: Date
): Promise<UserScoreData> {
  const periodStart = getPeriodStartDate(period, now);

  // Get all corrections by this user (via their session-user partition keys)
  // We need to find all segments where this user has corrections AND consensus is confirmed
  const userCorrections = await getUserCorrectionsWithConsensus(userId, periodStart);

  let totalAnswers = 0;
  let correctAnswers = 0;

  for (const entry of userCorrections) {
    totalAnswers++;
    if (entry.userAnswer === entry.consensusText) {
      correctAnswers++;
    }
  }

  return {
    userId,
    displayName: '',
    totalAnswers,
    correctAnswers,
  };
}

/**
 * Get a user's corrections that have confirmed consensus results,
 * filtered by period start date.
 */
async function getUserCorrectionsWithConsensus(
  userId: string,
  periodStart: Date | null
): Promise<Array<{ userAnswer: string; consensusText: string }>> {
  // Query user's ranking data from GSI1 to find all sessions they participated in
  // Then for each session, find their corrections and check consensus
  const results: Array<{ userAnswer: string; consensusText: string }> = [];

  // Get all sessions the user has corrections for
  // We query corrections by scanning GSI1 for the user's corrections
  const sessionsResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `USER#${userId}`,
      },
    })
  );

  // Find session IDs from team memberships and assignments
  const sessionIds = new Set<string>();
  for (const item of sessionsResult.Items ?? []) {
    const sk = item['GSI1SK'] as string;
    if (sk?.startsWith('TEAM#')) {
      // This is a team membership — we need to find sessions via team assignments
      const teamId = sk.replace('TEAM#', '');
      const teamSessions = await getTeamSessionIds(teamId);
      teamSessions.forEach((s) => sessionIds.add(s));
    }
  }

  // For each session, get the user's corrections and check against consensus
  for (const sessionId of sessionIds) {
    const corrections = await getUserSessionCorrections(userId, sessionId);
    for (const correction of corrections) {
      const consensus = await getConsensusForSegment(sessionId, correction.segmentId);
      if (!consensus || consensus.status !== 'CONFIRMED') {
        // Skip segments without confirmed consensus (Requirement 12.10)
        continue;
      }

      // Check period filter
      if (periodStart && new Date(consensus.confirmedAt) < periodStart) {
        continue;
      }

      results.push({
        userAnswer: correction.afterText,
        consensusText: consensus.consensusText,
      });
    }
  }

  return results;
}

/**
 * Get session IDs assigned to a team.
 */
async function getTeamSessionIds(teamId: string): Promise<string[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
        ':prefix': 'ASSIGNMENT#',
      },
    })
  );

  return (result.Items ?? []).map((item) => {
    const sk = item['SK'] as string;
    return sk.replace('ASSIGNMENT#', '');
  });
}

/**
 * Get a user's corrections for a specific session.
 * Returns the latest correction per segment.
 */
async function getUserSessionCorrections(
  userId: string,
  sessionId: string
): Promise<Array<{ segmentId: string; afterText: string }>> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}#USER#${userId}`,
        ':prefix': 'CORRECTION#',
      },
      ScanIndexForward: false, // Latest first
    })
  );

  // Deduplicate by segmentId — keep the latest correction per segment
  const latestBySegment = new Map<string, { segmentId: string; afterText: string }>();
  for (const item of result.Items ?? []) {
    const segmentId = item['segmentId'] as string;
    if (!latestBySegment.has(segmentId)) {
      latestBySegment.set(segmentId, {
        segmentId,
        afterText: item['afterText'] as string,
      });
    }
  }

  return Array.from(latestBySegment.values());
}

/**
 * Get the consensus result for a specific segment.
 */
async function getConsensusForSegment(
  sessionId: string,
  segmentId: string
): Promise<{ consensusText: string; status: string; confirmedAt: string } | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':sk': `CONSENSUS#${segmentId}`,
      },
      Limit: 1,
    })
  );

  const item = result.Items?.[0];
  if (!item) {
    return null;
  }

  return {
    consensusText: item['consensusText'] as string,
    status: item['status'] as string,
    confirmedAt: item['confirmedAt'] as string,
  };
}

/**
 * Delete existing ranking entry for a user in a specific period.
 * Queries GSI1 to find the current entry, then deletes it.
 */
async function deleteExistingRankingEntry(userId: string, period: ScorePeriod): Promise<void> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk',
      ExpressionAttributeValues: {
        ':gsi1pk': `USER#${userId}`,
        ':gsi1sk': `RANKING#${period}`,
      },
      Limit: 1,
    })
  );

  const item = result.Items?.[0];
  if (item) {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: item['PK'] as string,
          SK: item['SK'] as string,
        },
      })
    );
  }
}

/**
 * Get user display name from DynamoDB.
 */
async function getUserDisplayName(userId: string): Promise<string> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'METADATA',
      },
      Limit: 1,
    })
  );

  const item = result.Items?.[0];
  return (item?.['displayName'] as string) ?? '';
}
