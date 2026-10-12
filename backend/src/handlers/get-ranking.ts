/**
 * GET /ranking
 *
 * Retrieves the ContributorRanking for the specified period.
 * Rankings are sorted by ContributorScore descending, with ties broken
 * by answerCount descending (handled by DynamoDB sort key design).
 *
 * Supports pagination (50 items per page) and admin display scope control.
 *
 * Query parameters:
 *   - period (optional): ALL | THIS_MONTH | THIS_YEAR | LAST_30_DAYS | LAST_90_DAYS
 *     Defaults to ALL.
 *   - page (optional): Page number (1-based), default 1
 *
 * Response:
 *   {
 *     data: {
 *       rankings: RankingEntry[],
 *       currentUser: RankingEntry | null,
 *       pagination: { currentPage, pageSize, totalItems, totalPages, hasNextPage, hasPreviousPage }
 *     }
 *   }
 *
 * Requirements: 12.1, 12.3, 12.5, 12.6, 12.7, 12.8, 12.11, 12.12, 11.7
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import { getRankingSettings } from './admin-ranking-settings.js';
import type { ScorePeriod } from '../services/score-service.js';

export interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  answerCount: number;
  accuracyRate: number;
  score: number;
}

const VALID_PERIODS: ScorePeriod[] = [
  'ALL',
  'THIS_MONTH',
  'THIS_YEAR',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
];

const PAGE_SIZE = 50;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Validate period query parameter
    const periodParam = event.queryStringParameters?.period ?? 'ALL';
    if (!isValidPeriod(periodParam)) {
      throw validationError(
        'period パラメータが不正です。ALL, THIS_MONTH, THIS_YEAR, LAST_30_DAYS, LAST_90_DAYS のいずれかを指定してください。'
      );
    }

    // Validate page query parameter
    const pageParam = event.queryStringParameters?.page;
    let page = 1;
    if (pageParam) {
      page = parseInt(pageParam, 10);
      if (isNaN(page) || page < 1) {
        throw validationError('page パラメータは1以上の整数で指定してください。');
      }
    }

    const period = periodParam as ScorePeriod;

    try {
      // Get admin display scope settings
      const settings = await getRankingSettings();

      // Determine effective limit based on display scope
      let effectiveLimit: number | undefined;
      if (settings.displayScope === 'TOP_N' && settings.topN) {
        effectiveLimit = settings.topN;
      }

      // Query all ranking entries (up to effective limit)
      const allItems = await queryRankingEntries(period, effectiveLimit);

      // Apply display scope filtering
      let filteredItems = allItems;
      if (settings.displayScope === 'TEAM_ONLY') {
        // For TEAM_ONLY, filter to users in the same team as the current user
        const teamUserIds = await getTeamMemberIds(user.userId);
        if (teamUserIds) {
          filteredItems = allItems.filter((item) => teamUserIds.has(item.userId));
        }
      }

      // Calculate pagination
      const totalItems = filteredItems.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
      const startIndex = (page - 1) * PAGE_SIZE;
      const paginatedItems = filteredItems.slice(startIndex, startIndex + PAGE_SIZE);

      // Build ranked entries with rank numbers
      const rankings: RankingEntry[] = paginatedItems.map((item, index) => ({
        rank: startIndex + index + 1,
        userId: item.userId,
        displayName: item.displayName,
        answerCount: item.answerCount,
        accuracyRate: item.accuracyRate,
        score: item.score,
      }));

      // Find current user in all rankings (not just current page)
      let currentUser: RankingEntry | null = null;
      const userIndexInAll = filteredItems.findIndex((r) => r.userId === user.userId);

      if (userIndexInAll >= 0) {
        const item = filteredItems[userIndexInAll];
        currentUser = {
          rank: userIndexInAll + 1,
          userId: item.userId,
          displayName: item.displayName,
          answerCount: item.answerCount,
          accuracyRate: item.accuracyRate,
          score: item.score,
        };
      } else {
        // User not in filtered rankings — query their individual entry
        currentUser = await queryUserRankingEntry(user.userId, period);
      }

      return successResponse({
        data: {
          rankings,
          currentUser,
          pagination: {
            currentPage: page,
            pageSize: PAGE_SIZE,
            totalItems,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
        },
      });
    } catch (queryError: unknown) {
      throw internalError(
        'ランキングの取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * Query ranking entries from DynamoDB for a given period.
 * Uses PK=RANKING#{period} with ascending SK sort (inverted score = descending score order).
 */
async function queryRankingEntries(
  period: ScorePeriod,
  limit?: number
): Promise<Array<{ userId: string; displayName: string; answerCount: number; accuracyRate: number; score: number }>> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `RANKING#${period}`,
        ':prefix': 'SCORE#',
      },
      ScanIndexForward: true, // Ascending SK = descending score (inverted)
      ...(limit ? { Limit: limit } : {}),
    })
  );

  return (result.Items ?? []).map((item) => ({
    userId: item['userId'] as string,
    displayName: item['displayName'] as string,
    answerCount: item['answerCount'] as number,
    accuracyRate: item['accuracyRate'] as number,
    score: item['score'] as number,
  }));
}

/**
 * Query a specific user's ranking entry using GSI1.
 * GSI1PK=USER#{userId}, GSI1SK=RANKING#{period}
 *
 * If found, determines the user's rank by counting entries with higher scores.
 */
async function queryUserRankingEntry(
  userId: string,
  period: ScorePeriod
): Promise<RankingEntry | null> {
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
  if (!item) {
    return null;
  }

  const score = item['score'] as number;
  const sk = item['SK'] as string;

  // Count entries with higher score (lower SK value due to inversion)
  // to determine the user's rank
  const rank = await countEntriesAbove(period, sk);

  return {
    rank,
    userId: item['userId'] as string,
    displayName: item['displayName'] as string,
    answerCount: item['answerCount'] as number,
    accuracyRate: item['accuracyRate'] as number,
    score,
  };
}

/**
 * Count the number of ranking entries above a given sort key position.
 * This determines the user's rank.
 */
async function countEntriesAbove(period: ScorePeriod, userSk: string): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK < :sk',
      ExpressionAttributeValues: {
        ':pk': `RANKING#${period}`,
        ':sk': userSk,
      },
      Select: 'COUNT',
    })
  );

  return (result.Count ?? 0) + 1;
}

/**
 * Get team member user IDs for the current user.
 * Returns a Set of userIds in the same teams, or null if user has no teams.
 */
async function getTeamMemberIds(userId: string): Promise<Set<string> | null> {
  // First, get the user's team memberships
  const membershipResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `USER#${userId}`,
        ':prefix': 'TEAM#',
      },
    })
  );

  const teamIds = (membershipResult.Items ?? []).map(
    (item) => (item['PK'] as string).replace('TEAM#', '')
  );

  if (teamIds.length === 0) {
    return null;
  }

  // Get all members of those teams
  const memberIds = new Set<string>();
  memberIds.add(userId); // Always include self

  for (const teamId of teamIds) {
    const membersResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `TEAM#${teamId}`,
          ':prefix': 'MEMBER#',
        },
      })
    );

    for (const item of membersResult.Items ?? []) {
      const memberId = (item['SK'] as string).replace('MEMBER#', '');
      memberIds.add(memberId);
    }
  }

  return memberIds;
}

function isValidPeriod(period: string): period is ScorePeriod {
  return (VALID_PERIODS as string[]).includes(period);
}
