import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-consensus.js';

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn().mockImplementation((params) => params),
}));

const mockSend = vi.fn();
vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

function createEvent(
  overrides: Partial<{
    userId: string;
    role: string;
    sessionId: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'admin-001',
    role = 'ADMIN',
    sessionId = 'session-123',
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /consensus/{sessionId}/segments',
    rawPath: `/consensus/${sessionId}/segments`,
    rawQueryString: '',
    headers: {},
    pathParameters: sessionId ? { sessionId } : undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'admin@example.com',
            'custom:role': role,
            'custom:displayName': 'Admin User',
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: `/consensus/${sessionId}/segments`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /consensus/{sessionId}/segments',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleSegments = [
  {
    PK: 'SESSION#session-123',
    SK: 'SEGMENT#00001.000#seg-1',
    segmentId: 'seg-1',
    sessionId: 'session-123',
    startTime: 1.0,
    endTime: 5.0,
    originalText: 'Hello world',
    consensusStatus: 'CONFIRMED',
    consensusText: 'Hello world',
  },
  {
    PK: 'SESSION#session-123',
    SK: 'SEGMENT#00005.000#seg-2',
    segmentId: 'seg-2',
    sessionId: 'session-123',
    startTime: 5.0,
    endTime: 10.0,
    originalText: 'Good morning',
    consensusStatus: 'CONFLICT',
  },
  {
    PK: 'SESSION#session-123',
    SK: 'SEGMENT#00010.000#seg-3',
    segmentId: 'seg-3',
    sessionId: 'session-123',
    startTime: 10.0,
    endTime: 15.0,
    originalText: 'Thank you',
    consensusStatus: 'UNDECIDED',
  },
];

const sampleCorrections = [
  { userId: 'user-1', afterText: 'Good morning everyone' },
  { userId: 'user-2', afterText: 'Good morning everyone' },
  { userId: 'user-3', afterText: 'Good morning all' },
];

describe('GET /consensus/{sessionId}/segments handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-ADMIN users', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 for TEAM_LEADER users', async () => {
    const event = createEvent({ role: 'TEAM_LEADER' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns segments with consensus status for ADMIN', async () => {
    // First call: get segments
    mockSend.mockResolvedValueOnce({ Items: [sampleSegments[0], sampleSegments[2]] });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].segmentId).toBe('seg-1');
    expect(body.data[0].consensusStatus).toBe('CONFIRMED');
    expect(body.data[1].segmentId).toBe('seg-3');
    expect(body.data[1].consensusStatus).toBe('UNDECIDED');
  });

  it('enriches CONFLICT segments with reviewer answers', async () => {
    // First call: get segments (includes a CONFLICT segment)
    mockSend.mockResolvedValueOnce({ Items: [sampleSegments[1]] });
    // Second call: get corrections for CONFLICT segment
    mockSend.mockResolvedValueOnce({
      Items: sampleCorrections.map((c) => ({
        ...c,
        PK: `SESSION#session-123#USER#${c.userId}`,
        SK: `CORRECTION#2024-01-01T00:00:00.000Z#corr-1`,
      })),
    });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].consensusStatus).toBe('CONFLICT');
    expect(body.data[0].reviewerAnswers).toBeDefined();
    expect(body.data[0].reviewerAnswers).toHaveLength(2);

    // Check aggregated answers
    const answers = body.data[0].reviewerAnswers;
    const morningEveryone = answers.find(
      (a: { text: string }) => a.text === 'Good morning everyone'
    );
    const morningAll = answers.find(
      (a: { text: string }) => a.text === 'Good morning all'
    );
    expect(morningEveryone.count).toBe(2);
    expect(morningEveryone.userIds).toEqual(['user-1', 'user-2']);
    expect(morningAll.count).toBe(1);
    expect(morningAll.userIds).toEqual(['user-3']);
  });

  it('does not include reviewerAnswers for CONFIRMED segments', async () => {
    mockSend.mockResolvedValueOnce({ Items: [sampleSegments[0]] });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data[0].reviewerAnswers).toBeUndefined();
  });

  it('does not include reviewerAnswers for UNDECIDED segments', async () => {
    mockSend.mockResolvedValueOnce({ Items: [sampleSegments[2]] });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data[0].reviewerAnswers).toBeUndefined();
  });

  it('returns empty array when session has no segments', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toEqual([]);
  });

  it('returns 500 when DynamoDB query fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Consensus 状態の取得に失敗しました。');
  });

  it('deduplicates corrections by userId keeping latest', async () => {
    // Segment with CONFLICT status
    mockSend.mockResolvedValueOnce({ Items: [sampleSegments[1]] });
    // Corrections with duplicate userId (user-1 submitted twice)
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'First answer' },
        { userId: 'user-1', afterText: 'Updated answer' },
        { userId: 'user-2', afterText: 'Updated answer' },
      ],
    });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    const answers = body.data[0].reviewerAnswers;
    // user-1's latest answer is "Updated answer", same as user-2
    expect(answers).toHaveLength(1);
    expect(answers[0].text).toBe('Updated answer');
    expect(answers[0].count).toBe(2);
  });
});
