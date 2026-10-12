/**
 * GET /consensus/{sessionId}/segments
 *
 * Admin-only endpoint that returns segments with their consensus status
 * and reviewer answers for a given session.
 *
 * For CONFLICT segments, includes each reviewer's answer and count.
 *
 * Requirements: 10.6, 10.7, 10.9
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

export interface ConsensusSegment {
  segmentId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel?: string;
  consensusStatus: 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT';
  consensusText?: string;
  reviewerAnswers?: ReviewerAnswer[];
}

export interface ReviewerAnswer {
  text: string;
  count: number;
  userIds: string[];
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

    try {
      // Get all segments for the session
      const segments = await getSessionSegments(sessionId);

      // For CONFLICT segments, get reviewer answers
      const enrichedSegments: ConsensusSegment[] = await Promise.all(
        segments.map(async (segment) => {
          if (segment.consensusStatus === 'CONFLICT') {
            const answers = await getReviewerAnswers(segment.segmentId);
            return { ...segment, reviewerAnswers: answers };
          }
          return segment;
        })
      );

      return successResponse({ data: enrichedSegments });
    } catch (queryError: unknown) {
      throw internalError(
        'Consensus 状態の取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * Get all segments for a session from DynamoDB.
 */
async function getSessionSegments(sessionId: string): Promise<ConsensusSegment[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'SEGMENT#',
      },
      ScanIndexForward: true,
    })
  );

  return (result.Items ?? []).map((item) => ({
    segmentId: item['segmentId'] as string,
    sessionId: item['sessionId'] as string,
    startTime: item['startTime'] as number,
    endTime: item['endTime'] as number,
    originalText: item['originalText'] as string,
    speakerLabel: item['speakerLabel'] as string | undefined,
    consensusStatus: (item['consensusStatus'] as 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT') ?? 'UNDECIDED',
    consensusText: item['consensusText'] as string | undefined,
  }));
}

/**
 * Get reviewer answers for a specific segment.
 * Queries corrections via GSI1 and aggregates by answer text.
 */
async function getReviewerAnswers(segmentId: string): Promise<ReviewerAnswer[]> {
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

  // Deduplicate by userId (keep latest correction per reviewer)
  const latestByUser = new Map<string, { userId: string; afterText: string }>();
  for (const item of result.Items ?? []) {
    const userId = item['userId'] as string;
    const afterText = item['afterText'] as string;
    latestByUser.set(userId, { userId, afterText });
  }

  // Aggregate by answer text
  const answerMap = new Map<string, { count: number; userIds: string[] }>();
  for (const { userId, afterText } of latestByUser.values()) {
    const existing = answerMap.get(afterText);
    if (existing) {
      existing.count += 1;
      existing.userIds.push(userId);
    } else {
      answerMap.set(afterText, { count: 1, userIds: [userId] });
    }
  }

  return Array.from(answerMap.entries()).map(([text, { count, userIds }]) => ({
    text,
    count,
    userIds,
  }));
}
