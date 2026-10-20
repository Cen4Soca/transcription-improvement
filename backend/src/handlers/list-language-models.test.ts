import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './list-language-models.js';


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

vi.mock('../services/language-model-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/language-model-service.js')>();
  return {
    ...actual,
    listModels: vi.fn(),
  };
});

import { listModels } from '../services/language-model-service.js';

const mockedListModels = vi.mocked(listModels);

function createEvent(
  overrides: Partial<{
    userId: string;
    role: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'user-001',
    role = 'REVIEWER',
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /language-models',
    rawPath: '/language-models',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'test@example.com',
            'custom:role': role,
            'custom:displayName': 'Test User',
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: '/language-models',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /language-models',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /language-models handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListModels.mockResolvedValue([
      {
        modelName: 'model-a',
        modelStatus: 'COMPLETED',
        baseModelName: 'WideBand',
        createTime: '2024-01-01T00:00:00.000Z',
      },
      {
        modelName: 'model-b',
        modelStatus: 'COMPLETED',
        baseModelName: 'NarrowBand',
        createTime: '2024-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('returns 200 with model list', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.models).toHaveLength(2);
    expect(body.models[0].modelName).toBe('model-a');
    expect(body.models[1].modelName).toBe('model-b');
  });

  it('calls listModels service', async () => {
    const event = createEvent();
    await handler(event);

    expect(mockedListModels).toHaveBeenCalledTimes(1);
  });

  it('returns empty list when no models available', async () => {
    mockedListModels.mockResolvedValue([]);

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.models).toHaveLength(0);
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 for unexpected errors', async () => {
    mockedListModels.mockRejectedValue(new Error('Transcribe API unavailable'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
