import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-ranking.js';

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

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    period: string | undefined;
    page: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'user-001',
    email = 'test@example.com',
    role = 'REVIEWER',
    displayName = 'Test User',
    period,
    page,
  } = overrides;

  const queryParams: Record<string, string> = {};
  if (period) queryParams['period'] = period;
  if (page) queryParams['page'] = page;

  return {
    version: '2.0',
    routeKey: 'GET /ranking',
    rawPath: '/ranking',
    rawQueryString: Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join('&'),
    headers: {},
    queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email,
            'custom:role': role,
            'custom:displayName': displayName,
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

const sampleRankingItems = [
  {
    PK: 'RANKING#ALL',
    SK: 'SCORE#9999999914.5000#user-a',
    userId: 'user-a',
    displayName: 'Alice',
    answerCount: 100,
    accuracyRate: 85.5,
    score: 85.5,
  },
  {
    PK: 'RANKING#ALL',
    SK: 'SCORE#9999999930.0000#user-b',
    userId: 'user-b',
    displayName: 'Bob',
    answerCount: 50,
    accuracyRate: 80.0,
    score: 40.0,
  },
  {
    PK: 'RANKING#ALL',
    SK: 'SCORE#9999999993.0000#user-c',
    userId: 'user-c',
    displayName: 'Charlie',
    answerCount: 10,
    accuracyRate: 70.0,
    score: 7.0,
  },
];

// Default settings mock: ALL_USERS display scope
function mockDefaultSettings() {
  mockSend.mockImplementation((cmd: Record<string, unknown>) => {
    // GetCommand for settings
    if (cmd['TableName'] === 'TestTable' && cmd['Key'] && (cmd['Key'] as Record<string, string>)['PK'] === 'SETTINGS') {
      return Promise.resolve({ Item: null });
    }
    return Promise.resolve({ Items: [], Count: 0 });
  });
}

describe('GET /ranking handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ranking entries sorted by score descending with default period ALL', async () => {
    // Settings query (GetCommand)
    mockSend.mockResolvedValueOnce({ Item: null }); // default settings
    // Ranking query
    mockSend.mockResolvedValueOnce({ Items: sampleRankingItems, Count: 3 });
    // GSI1 query for current user (not in rankings)
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const event = createEvent({ userId: 'user-x' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.rankings).toHaveLength(3);
    expect(body.data.rankings[0].rank).toBe(1);
    expect(body.data.rankings[0].userId).toBe('user-a');
    expect(body.data.rankings[0].score).toBe(85.5);
    expect(body.data.rankings[1].rank).toBe(2);
    expect(body.data.rankings[2].rank).toBe(3);
  });

  it('includes currentUser when user is in the rankings', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // settings
    mockSend.mockResolvedValueOnce({ Items: sampleRankingItems, Count: 3 });

    const event = createEvent({ userId: 'user-b' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.currentUser).not.toBeNull();
    expect(body.data.currentUser.userId).toBe('user-b');
    expect(body.data.currentUser.rank).toBe(2);
  });

  it('queries user entry from GSI1 when not in top rankings', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // settings
    mockSend.mockResolvedValueOnce({ Items: sampleRankingItems, Count: 3 });
    // GSI1 query returns user's entry
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'RANKING#ALL',
          SK: 'SCORE#9999999998.0000#user-x',
          GSI1PK: 'USER#user-x',
          GSI1SK: 'RANKING#ALL',
          userId: 'user-x',
          displayName: 'Xavier',
          answerCount: 5,
          accuracyRate: 40.0,
          score: 2.0,
        },
      ],
      Count: 1,
    });
    // Count entries above
    mockSend.mockResolvedValueOnce({ Count: 3 });

    const event = createEvent({ userId: 'user-x', displayName: 'Xavier' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.currentUser).not.toBeNull();
    expect(body.data.currentUser.userId).toBe('user-x');
    expect(body.data.currentUser.rank).toBe(4);
    expect(body.data.currentUser.score).toBe(2.0);
  });

  it('returns null currentUser when user has no ranking entry', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // settings
    mockSend.mockResolvedValueOnce({ Items: sampleRankingItems, Count: 3 });
    // GSI1 query returns nothing
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const event = createEvent({ userId: 'user-new' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.currentUser).toBeNull();
  });

  it('returns empty rankings when no entries exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // settings
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.rankings).toEqual([]);
    expect(body.data.currentUser).toBeNull();
  });

  it('accepts valid period parameter THIS_MONTH', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // settings
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const event = createEvent({ period: 'THIS_MONTH' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
  });

  it('accepts valid period parameter LAST_30_DAYS', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // settings
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const event = createEvent({ period: 'LAST_30_DAYS' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
  });

  it('returns 400 for invalid period parameter', async () => {
    const event = createEvent({ period: 'INVALID' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('period パラメータが不正です');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 when DynamoDB query fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('ランキングの取得に失敗しました。');
    expect(body.error.details).toBe('DynamoDB timeout');
  });

  it('returns ranking entries with correct shape', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // settings
    mockSend.mockResolvedValueOnce({ Items: [sampleRankingItems[0]], Count: 1 });

    const event = createEvent({ userId: 'user-a' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    const entry = body.data.rankings[0];
    expect(entry).toEqual({
      rank: 1,
      userId: 'user-a',
      displayName: 'Alice',
      answerCount: 100,
      accuracyRate: 85.5,
      score: 85.5,
    });
  });

  describe('pagination (Req 11.7)', () => {
    it('returns pagination info in response', async () => {
      mockSend.mockResolvedValueOnce({ Item: null }); // settings
      mockSend.mockResolvedValueOnce({ Items: sampleRankingItems, Count: 3 });

      const event = createEvent({ userId: 'user-a' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.pagination).toEqual({
        currentPage: 1,
        pageSize: 50,
        totalItems: 3,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('returns 400 for invalid page parameter', async () => {
      const event = createEvent({ page: '0' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('page パラメータは1以上の整数');
    });

    it('returns 400 for non-numeric page parameter', async () => {
      const event = createEvent({ page: 'abc' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts valid page parameter', async () => {
      mockSend.mockResolvedValueOnce({ Item: null }); // settings
      mockSend.mockResolvedValueOnce({ Items: sampleRankingItems, Count: 3 });

      const event = createEvent({ userId: 'user-a', page: '1' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.pagination.currentPage).toBe(1);
    });
  });

  describe('admin display scope control (Req 12.12)', () => {
    it('applies TOP_N limit from settings', async () => {
      // Settings with TOP_N = 2
      mockSend.mockResolvedValueOnce({
        Item: { displayScope: 'TOP_N', topN: 2, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin-1' },
      });
      // Ranking query (limited to 2)
      mockSend.mockResolvedValueOnce({ Items: sampleRankingItems.slice(0, 2), Count: 2 });
      // GSI1 query for current user
      mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

      const event = createEvent({ userId: 'user-x' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.rankings).toHaveLength(2);
      expect(body.data.pagination.totalItems).toBe(2);
    });

    it('applies TEAM_ONLY filter from settings', async () => {
      // Settings with TEAM_ONLY
      mockSend.mockResolvedValueOnce({
        Item: { displayScope: 'TEAM_ONLY', updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin-1' },
      });
      // Ranking query (all items)
      mockSend.mockResolvedValueOnce({ Items: sampleRankingItems, Count: 3 });
      // Team membership query for current user (GSI1)
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'TEAM#team-1', SK: 'MEMBER#user-001', GSI1PK: 'USER#user-001', GSI1SK: 'TEAM#team-1' }],
      });
      // Team members query
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'TEAM#team-1', SK: 'MEMBER#user-001' },
          { PK: 'TEAM#team-1', SK: 'MEMBER#user-a' },
        ],
      });
      // GSI1 query for current user ranking entry
      mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

      const event = createEvent({ userId: 'user-001' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      // Only user-a is in the team and in rankings
      expect(body.data.rankings).toHaveLength(1);
      expect(body.data.rankings[0].userId).toBe('user-a');
    });
  });
});
