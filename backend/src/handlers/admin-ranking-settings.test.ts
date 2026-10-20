import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { getHandler, patchHandler } from './admin-ranking-settings.js';


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

vi.mock('@aws-sdk/lib-dynamodb', () => ({
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
    role: string;
    body: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'admin-001',
    role = 'ADMIN',
    body,
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /admin/settings/ranking',
    rawPath: '/admin/settings/ranking',
    rawQueryString: '',
    headers: {},
    queryStringParameters: undefined,
    body,
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
        path: '/admin/settings/ranking',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /admin/settings/ranking',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    pathParameters: undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /admin/settings/ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default settings when no settings exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: null });

    const event = createEvent();
    const result = await getHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.displayScope).toBe('ALL_USERS');
    expect(body.data.topN).toBeUndefined();
  });

  it('returns stored settings', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'SETTINGS',
        SK: 'RANKING',
        displayScope: 'TOP_N',
        topN: 10,
        updatedAt: '2024-01-01T00:00:00Z',
        updatedBy: 'admin-001',
      },
    });

    const event = createEvent();
    const result = await getHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.displayScope).toBe('TOP_N');
    expect(body.data.topN).toBe(10);
    expect(body.data.updatedBy).toBe('admin-001');
  });

  it('returns 403 for non-admin users', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await getHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 when DynamoDB fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

    const event = createEvent();
    const result = await getHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('PATCH /admin/settings/ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates settings with ALL_USERS scope', async () => {
    mockSend.mockResolvedValueOnce({}); // UpdateCommand

    const event = createEvent({
      body: JSON.stringify({ displayScope: 'ALL_USERS' }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.displayScope).toBe('ALL_USERS');
    expect(body.data.updatedBy).toBe('admin-001');
  });

  it('updates settings with TOP_N scope and topN value', async () => {
    mockSend.mockResolvedValueOnce({}); // UpdateCommand

    const event = createEvent({
      body: JSON.stringify({ displayScope: 'TOP_N', topN: 20 }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.displayScope).toBe('TOP_N');
    expect(body.data.topN).toBe(20);
  });

  it('updates settings with TEAM_ONLY scope', async () => {
    mockSend.mockResolvedValueOnce({}); // UpdateCommand

    const event = createEvent({
      body: JSON.stringify({ displayScope: 'TEAM_ONLY' }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.displayScope).toBe('TEAM_ONLY');
  });

  it('returns 400 for invalid displayScope', async () => {
    const event = createEvent({
      body: JSON.stringify({ displayScope: 'INVALID' }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('displayScope');
  });

  it('returns 400 when TOP_N scope is missing topN', async () => {
    const event = createEvent({
      body: JSON.stringify({ displayScope: 'TOP_N' }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('topN');
  });

  it('returns 400 when TOP_N scope has topN less than 1', async () => {
    const event = createEvent({
      body: JSON.stringify({ displayScope: 'TOP_N', topN: 0 }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when TOP_N scope has non-integer topN', async () => {
    const event = createEvent({
      body: JSON.stringify({ displayScope: 'TOP_N', topN: 5.5 }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body is missing', async () => {
    const event = createEvent({ body: undefined });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const event = createEvent({ body: 'not json' });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for non-admin users', async () => {
    const event = createEvent({
      role: 'TEAM_LEADER',
      body: JSON.stringify({ displayScope: 'ALL_USERS' }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 when DynamoDB update fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB write error'));

    const event = createEvent({
      body: JSON.stringify({ displayScope: 'ALL_USERS' }),
    });
    const result = await patchHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
