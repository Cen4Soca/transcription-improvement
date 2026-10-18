import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-media-url.js';

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/media-service.js', () => ({
  getMediaUrl: vi.fn(),
}));

import { checkSessionAccess } from '../services/access-control-service.js';
import { getMediaUrl } from '../services/media-service.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedGetMediaUrl = vi.mocked(getMediaUrl);

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
    routeKey: 'GET /sessions/{sessionId}/media-url',
    rawPath: `/sessions/${sessionId}/media-url`,
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
        path: `/sessions/${sessionId}/media-url`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /sessions/{sessionId}/media-url',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    pathParameters: sessionId !== undefined ? { sessionId } : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /sessions/{sessionId}/media-url handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCheckSessionAccess.mockResolvedValue(undefined);
  });

  it('returns signed URL and expiration wrapped in data for a valid request', async () => {
    const mediaUrlResult = {
      data: {
        url: 'https://d1234.cloudfront.net/media/file-123/audio.mp3?Expires=1704067500&Signature=abc&Key-Pair-Id=KXYZ',
        expiresAt: '2024-01-01T00:05:00.000Z',
      },
    };
    mockedGetMediaUrl.mockResolvedValue(mediaUrlResult);

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.url).toBe(mediaUrlResult.data.url);
    expect(body.data.expiresAt).toBe(mediaUrlResult.data.expiresAt);
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

  it('returns 404 when media file is not found for the session', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGetMediaUrl.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'メディアファイルが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('メディアファイルが見つかりません。');
  });

  it('returns 403 when scanStatus is PENDING', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGetMediaUrl.mockRejectedValue(
      new AppError({
        code: 'FORBIDDEN',
        message: 'マルウェアスキャン完了前のファイルにはアクセスできません',
        statusCode: 403,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('マルウェアスキャン完了前のファイルにはアクセスできません');
  });

  it('returns 403 when scanStatus is INFECTED', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGetMediaUrl.mockRejectedValue(
      new AppError({
        code: 'FORBIDDEN',
        message: 'マルウェアが検出されたファイルにはアクセスできません',
        statusCode: 403,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('マルウェアが検出されたファイルにはアクセスできません');
  });

  it('returns 500 when CloudFront signing configuration is missing', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGetMediaUrl.mockRejectedValue(
      new AppError({
        code: 'INTERNAL_ERROR',
        message: 'メディアURL生成の設定が不足しています。',
        statusCode: 500,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('メディアURL生成の設定が不足しています。');
  });

  it('calls checkSessionAccess with correct user and sessionId', async () => {
    mockedGetMediaUrl.mockResolvedValue({
      data: {
        url: 'https://d1234.cloudfront.net/media/file-abc/audio.mp3?signed',
        expiresAt: '2024-01-01T00:05:00.000Z',
      },
    });

    const event = createEvent({ userId: 'user-xyz', sessionId: 'session-abc' });
    await handler(event);

    expect(mockedCheckSessionAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-xyz' }),
      'session-abc'
    );
  });

  it('calls getMediaUrl with correct sessionId', async () => {
    mockedGetMediaUrl.mockResolvedValue({
      data: {
        url: 'https://d1234.cloudfront.net/media/file-abc/audio.mp3?signed',
        expiresAt: '2024-01-01T00:05:00.000Z',
      },
    });

    const event = createEvent({ sessionId: 'session-abc' });
    await handler(event);

    expect(mockedGetMediaUrl).toHaveBeenCalledWith('session-abc');
  });

  it('does not call getMediaUrl when session access is denied', async () => {
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

    expect(mockedGetMediaUrl).not.toHaveBeenCalled();
  });
});
