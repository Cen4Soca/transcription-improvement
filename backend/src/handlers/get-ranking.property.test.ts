import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn().mockImplementation((params) => params),
  GetCommand: vi.fn().mockImplementation((params) => params),
  UpdateCommand: vi.fn().mockImplementation((params) => params),
}));

const mockSend = vi.fn();
vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

import { handler } from './get-ranking.js';


vi.mock('../utils/auth-middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/auth-middleware.js')>();
  const { forbiddenError } = await import('../utils/error-handler.js');
  return {
    ...actual,
    // Handler unit tests isolate handler logic from identity resolution by
    // reproducing claim-based extraction (sub -> userId). The real extractUser's
    // canonical-userId resolution is covered in auth-middleware.test.ts.
    extractUser: vi.fn(async (event: any) => {
      const claims = event.requestContext.authorizer.jwt.claims;
      const sub = (claims['sub'] as string) ?? '';
      if (!sub) {
        throw forbiddenError('認証情報が不正です。', 'Missing sub claim in JWT');
      }
      const role = (claims['custom:role'] as string) || 'REVIEWER';
      return {
        userId: sub,
        email: (claims['email'] as string) ?? '',
        displayName: (claims['custom:displayName'] as string) ?? '',
        role,
      };
    }),
  };
});

function createEvent(userId: string): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /ranking',
    rawPath: '/ranking',
    rawQueryString: '',
    headers: {},
    queryStringParameters: undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: `${userId}@example.com`,
            'custom:role': 'REVIEWER',
            'custom:displayName': `User ${userId}`,
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: '/ranking',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /ranking',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    pathParameters: undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

interface RankingUser {
  userId: string;
  score: number;
  answerCount: number;
}

function buildRankingItems(users: RankingUser[]) {
  return users.map((u) => ({
    PK: 'RANKING#ALL',
    SK: `SCORE#${String(99999999 - u.score).padStart(10, '0')}#${u.userId}`,
    userId: u.userId,
    displayName: `User ${u.userId}`,
    answerCount: u.answerCount,
    accuracyRate: 80.0,
    score: u.score,
  }));
}

/**
 * Arbitrary: generates a list of unique ranking users (1-20 users)
 */
const rankingUsersArb = fc
  .uniqueArray(
    fc.record({
      userId: fc.stringMatching(/^user-[a-z0-9]{3,8}$/),
      score: fc.double({ min: 0.01, max: 1000, noNaN: true }),
      answerCount: fc.nat({ max: 500 }),
    }),
    { minLength: 1, maxLength: 20, selector: (u) => u.userId }
  );

describe('Feature: transcription-review-app, Property 37: ランキング表示範囲の制御', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 12.12**
   *
   * When displayScope is ALL_USERS, all users with scores are shown in the ranking.
   */
  it('ALL_USERS scope shows all users with scores', async () => {
    await fc.assert(
      fc.asyncProperty(rankingUsersArb, async (users) => {
        vi.clearAllMocks();

        const items = buildRankingItems(users);

        // Settings: ALL_USERS
        mockSend.mockResolvedValueOnce({
          Item: { displayScope: 'ALL_USERS', updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin' },
        });
        // Ranking query returns all items
        mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

        const currentUserId = users[0].userId;
        const event = createEvent(currentUserId);
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body as string);

        // All users should be present in the ranking
        expect(body.data.pagination.totalItems).toBe(users.length);
        const returnedUserIds = body.data.rankings.map((r: { userId: string }) => r.userId);
        for (const user of users) {
          expect(returnedUserIds).toContain(user.userId);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 12.12**
   *
   * When displayScope is TEAM_ONLY, only users in the same team as the current user are shown.
   */
  it('TEAM_ONLY scope shows only users in the same team', async () => {
    await fc.assert(
      fc.asyncProperty(
        rankingUsersArb.filter((users) => users.length >= 2),
        fc.nat({ max: 10 }),
        async (users, teamMemberCountSeed) => {
          vi.clearAllMocks();

          const currentUserId = users[0].userId;
          // Determine team members: always include current user, plus a subset of others
          const teamMemberCount = Math.min(teamMemberCountSeed % (users.length - 1) + 1, users.length - 1);
          const teamMembers = [currentUserId, ...users.slice(1, 1 + teamMemberCount).map((u) => u.userId)];
          const teamMemberSet = new Set(teamMembers);

          const items = buildRankingItems(users);

          // Settings: TEAM_ONLY
          mockSend.mockResolvedValueOnce({
            Item: { displayScope: 'TEAM_ONLY', updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin' },
          });
          // Ranking query returns all items
          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });
          // Team membership query for current user (GSI1)
          mockSend.mockResolvedValueOnce({
            Items: [{ PK: 'TEAM#team-1', SK: `MEMBER#${currentUserId}`, GSI1PK: `USER#${currentUserId}`, GSI1SK: 'TEAM#team-1' }],
          });
          // Team members query
          mockSend.mockResolvedValueOnce({
            Items: teamMembers.map((id) => ({ PK: 'TEAM#team-1', SK: `MEMBER#${id}` })),
          });

          const event = createEvent(currentUserId);
          const result = await handler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body as string);

          // Only team members should appear in rankings
          const returnedUserIds: string[] = body.data.rankings.map((r: { userId: string }) => r.userId);
          for (const uid of returnedUserIds) {
            expect(teamMemberSet.has(uid)).toBe(true);
          }

          // All team members who have scores should be present
          const expectedTeamUsersInRanking = users.filter((u) => teamMemberSet.has(u.userId));
          expect(body.data.pagination.totalItems).toBe(expectedTeamUsersInRanking.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 12.12**
   *
   * When displayScope is TOP_N, only the top N users are shown.
   */
  it('TOP_N scope shows only the top N users', async () => {
    await fc.assert(
      fc.asyncProperty(
        rankingUsersArb,
        fc.integer({ min: 1, max: 20 }),
        async (users, topN) => {
          vi.clearAllMocks();

          // The effective limit is min(topN, users.length) since DynamoDB Limit caps results
          const effectiveN = Math.min(topN, users.length);

          // Sort users by score descending to simulate DynamoDB sort order
          const sortedUsers = [...users].sort((a, b) => b.score - a.score);
          const topItems = buildRankingItems(sortedUsers.slice(0, effectiveN));

          // Settings: TOP_N
          mockSend.mockResolvedValueOnce({
            Item: { displayScope: 'TOP_N', topN, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin' },
          });
          // Ranking query returns only top N items (DynamoDB Limit applied)
          mockSend.mockResolvedValueOnce({ Items: topItems, Count: topItems.length });

          const currentUserId = sortedUsers[0].userId;
          const event = createEvent(currentUserId);
          const result = await handler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body as string);

          // Should show at most topN users
          expect(body.data.pagination.totalItems).toBeLessThanOrEqual(topN);
          expect(body.data.pagination.totalItems).toBe(effectiveN);

          // The returned users should be the top N by score
          const returnedUserIds: string[] = body.data.rankings.map((r: { userId: string }) => r.userId);
          const expectedTopUserIds = sortedUsers.slice(0, effectiveN).map((u) => u.userId);
          expect(returnedUserIds).toEqual(expectedTopUserIds);
        }
      ),
      { numRuns: 100 }
    );
  });
});
