import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-corrections.js';

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../repositories/correction-repository.js', () => ({
  getCorrections: vi.fn(),
}));

import { checkSessionAccess } from '../services/access-control-service.js';
import { getCorrections } from '../repositories/correction-repository.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedGetCorrections = vi.mocked(getCorrections);

function createEvent(
  overrides: Partial<{
    sessionId: string | undefined;
    userId: string;
    email: string;
    role: string;
    displayName: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    sessionId = 'session-123',
    userId = 'user-001',
    email = 'test@example.com',
    role = 'REVIEWER',
    displayName = 'Test User',
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /sessions/{sessionId}/corrections',
    rawPath: `/sessions/${sessionId}/corrections`,
    rawQueryString: '',
    headers: {},
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
        path: `/sessions/${sessionId}/corrections`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /sessions/{sessionId}/corrections',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    pathParameters: sessionId !== undefined ? { sessionId } : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /sessions/{sessionId}/corrections handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCheckSessionAccess.mockResolvedValue(undefined);
  });

  it('returns corrections array for a valid request', async () => {
    const corrections = [
      {
        correctionId: 'corr-1',
        sessionId: 'session-123',
        segmentId: 'seg-1',
        userId: 'user-001',
        correctionType: 'TEXT' as const,
        beforeText: 'original',
        afterText: 'corrected',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        correctionId: 'corr-2',
        sessionId: 'session-123',
        segmentId: 'seg-2',
        userId: 'user-001',
        correctionType: 'SPEAKER' as const,
        beforeText: 'spk_0',
        afterText: 'spk_1',
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'spk_1',
        createdAt: '2024-01-01T00:01:00.000Z',
      },
    ];

    mockedGetCorrections.mockResolvedValue(corrections);

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toEqual(corrections);
    expect(body.data).toHaveLength(2);
  });

  it('returns empty array when no corrections exist', async () => {
    mockedGetCorrections.mockResolvedValue([]);

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toEqual([]);
  });

  it('returns 400 when sessionId path parameter is missing', async () => {
    const event = createEvent({ sessionId: undefined });
    event.pathParameters = undefined;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('sessionId パスパラメータが必要です。');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when user does not have session access', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedCheckSessionAccess.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 with restoration error message when DynamoDB query fails', async () => {
    mockedGetCorrections.mockRejectedValue(new Error('DynamoDB timeout'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('修正内容の復元に失敗しました。');
    expect(body.error.details).toBe('DynamoDB timeout');
  });

  it('calls checkSessionAccess with correct user and sessionId', async () => {
    mockedGetCorrections.mockResolvedValue([]);

    const event = createEvent({ userId: 'user-xyz', sessionId: 'session-abc' });
    await handler(event);

    expect(mockedCheckSessionAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-xyz' }),
      'session-abc'
    );
  });

  it('calls getCorrections with correct sessionId and userId', async () => {
    mockedGetCorrections.mockResolvedValue([]);

    const event = createEvent({ userId: 'user-xyz', sessionId: 'session-abc' });
    await handler(event);

    expect(mockedGetCorrections).toHaveBeenCalledWith('session-abc', 'user-xyz');
  });

  it('does not call getCorrections when session access is denied', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedCheckSessionAccess.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent();
    await handler(event);

    expect(mockedGetCorrections).not.toHaveBeenCalled();
  });

  describe('Answer concealment (Req 10.10)', () => {
    it('only returns corrections for the requesting user, not other reviewers', async () => {
      // User-A's corrections only
      const userACorrections = [
        {
          correctionId: 'corr-1',
          sessionId: 'session-123',
          segmentId: 'seg-1',
          userId: 'user-A',
          correctionType: 'TEXT' as const,
          beforeText: 'original',
          afterText: 'user-A answer',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      mockedGetCorrections.mockResolvedValue(userACorrections);

      const event = createEvent({ userId: 'user-A', sessionId: 'session-123' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);

      // Verify only user-A's corrections are returned
      expect(body.data).toHaveLength(1);
      expect(body.data[0].userId).toBe('user-A');
      expect(body.data[0].afterText).toBe('user-A answer');

      // Verify getCorrections was called with user-A's ID (not another user)
      expect(mockedGetCorrections).toHaveBeenCalledWith('session-123', 'user-A');
      expect(mockedGetCorrections).toHaveBeenCalledTimes(1);
    });

    it('different users requesting the same session get only their own corrections', async () => {
      // When user-B requests, they get only their corrections
      const userBCorrections = [
        {
          correctionId: 'corr-2',
          sessionId: 'session-123',
          segmentId: 'seg-1',
          userId: 'user-B',
          correctionType: 'TEXT' as const,
          beforeText: 'original',
          afterText: 'user-B answer',
          createdAt: '2024-01-01T00:01:00.000Z',
        },
      ];

      mockedGetCorrections.mockResolvedValue(userBCorrections);

      const event = createEvent({ userId: 'user-B', sessionId: 'session-123' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);

      // Verify only user-B's corrections are returned (user-A's are hidden)
      expect(body.data).toHaveLength(1);
      expect(body.data[0].userId).toBe('user-B');
      expect(body.data[0].afterText).toBe('user-B answer');

      // Verify the repository is queried with user-B's ID
      expect(mockedGetCorrections).toHaveBeenCalledWith('session-123', 'user-B');
    });

    it('never passes a different userId to getCorrections regardless of request', async () => {
      mockedGetCorrections.mockResolvedValue([]);

      // Even if someone tries to access, the handler always uses the JWT user
      const event = createEvent({ userId: 'user-C', sessionId: 'session-123' });
      await handler(event);

      // The handler must use the authenticated user's ID from JWT, not any query param
      expect(mockedGetCorrections).toHaveBeenCalledWith('session-123', 'user-C');
    });
  });
});
