import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-session-name-suggestion.js';


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

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/session-name-suggestion-service.js', () => ({
  suggestSessionName: vi.fn(),
}));

function createEvent(
  overrides: Partial<{
    sessionId: string;
    claims: Record<string, string>;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /sessions/{sessionId}/name-suggestion',
    rawPath: '/sessions/session-1/name-suggestion',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: 'user-1',
            email: 'test@example.com',
            'custom:displayName': 'Test User',
            'custom:role': 'REVIEWER',
            ...overrides.claims,
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: '/sessions/session-1/name-suggestion',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-1',
      routeKey: 'GET /sessions/{sessionId}/name-suggestion',
      stage: '$default',
      time: '2024-01-01T00:00:00Z',
      timeEpoch: 0,
    },
    pathParameters: {
      sessionId: overrides.sessionId ?? 'session-1',
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /sessions/{sessionId}/name-suggestion handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return suggestion and hasExternalApiError on success', async () => {
    const { checkSessionAccess } = await import('../services/access-control-service.js');
    const { suggestSessionName } = await import(
      '../services/session-name-suggestion-service.js'
    );
    vi.mocked(checkSessionAccess).mockResolvedValue(undefined);
    vi.mocked(suggestSessionName).mockResolvedValue({
      suggestion: '会議の議事録',
      hasExternalApiError: false,
    });

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body.suggestion).toBe('会議の議事録');
    expect(body.hasExternalApiError).toBe(false);
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent();
    event.pathParameters = {};

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('sessionId');
  });

  it('should return 404 when checkSessionAccess denies access', async () => {
    const { checkSessionAccess } = await import('../services/access-control-service.js');
    const { AppError } = await import('../utils/error-handler.js');
    vi.mocked(checkSessionAccess).mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'リソースが見つかりません。', statusCode: 404 })
    );

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(404);
  });

  it('should return 500 when suggestSessionName throws', async () => {
    const { checkSessionAccess } = await import('../services/access-control-service.js');
    const { suggestSessionName } = await import(
      '../services/session-name-suggestion-service.js'
    );
    vi.mocked(checkSessionAccess).mockResolvedValue(undefined);
    vi.mocked(suggestSessionName).mockRejectedValue(new Error('DynamoDB error'));

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toContain('セッション名候補の取得に失敗しました');
  });
});
