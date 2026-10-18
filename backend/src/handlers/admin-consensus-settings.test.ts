import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './admin-consensus-settings.js';

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: vi.fn().mockImplementation((params) => params),
  GetCommand: vi.fn().mockImplementation((params) => params),
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
    body = JSON.stringify({ partialAggregationEnabled: true }),
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'PATCH /admin/settings/consensus',
    rawPath: '/admin/settings/consensus',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    body,
    pathParameters: undefined,
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
        method: 'PATCH',
        path: '/admin/settings/consensus',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'PATCH /admin/settings/consensus',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('PATCH /admin/settings/consensus handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for REVIEWER users', async () => {
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

  it('returns 400 when body is missing', async () => {
    const event = createEvent({ body: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const event = createEvent({ body: 'not json' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when partialAggregationEnabled is not boolean', async () => {
    const event = createEvent({
      body: JSON.stringify({ partialAggregationEnabled: 'yes' }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('boolean');
  });

  it('returns 400 when partialAggregationEnabled is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ someOtherField: true }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('successfully enables partial aggregation for ADMIN', async () => {
    mockSend.mockResolvedValueOnce({});

    const event = createEvent({
      body: JSON.stringify({ partialAggregationEnabled: true }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.partialAggregationEnabled).toBe(true);
    expect(body.data.updatedBy).toBe('admin-001');
    expect(body.data.updatedAt).toBeDefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('successfully disables partial aggregation for ADMIN', async () => {
    mockSend.mockResolvedValueOnce({});

    const event = createEvent({
      body: JSON.stringify({ partialAggregationEnabled: false }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.partialAggregationEnabled).toBe(false);
  });

  it('returns 500 when DynamoDB update fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

    const event = createEvent({
      body: JSON.stringify({ partialAggregationEnabled: true }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Consensus 設定の更新に失敗しました。');
  });
});
