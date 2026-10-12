import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-model-status.js';

vi.mock('../services/language-model-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/language-model-service.js')>();
  return {
    ...actual,
    getModelStatus: vi.fn(),
  };
});

import { getModelStatus } from '../services/language-model-service.js';

const mockedGetModelStatus = vi.mocked(getModelStatus);

function createEvent(
  overrides: Partial<{
    modelName: string | undefined;
    userId: string;
    role: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const modelName = 'modelName' in overrides ? overrides.modelName : 'my-model';
  const {
    userId = 'user-001',
    role = 'ADMIN',
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /language-models/{modelName}',
    rawPath: `/language-models/${modelName ?? ''}`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    pathParameters: modelName ? { modelName } : undefined,
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
        path: `/language-models/${modelName ?? ''}`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /language-models/{modelName}',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /language-models/{modelName} handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetModelStatus.mockResolvedValue({
      modelName: 'my-model',
      modelStatus: 'COMPLETED',
      baseModelName: 'WideBand',
      failureReason: undefined,
    });
  });

  it('returns 200 with model status for a valid request', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.modelName).toBe('my-model');
    expect(body.modelStatus).toBe('COMPLETED');
    expect(body.baseModelName).toBe('WideBand');
  });

  it('calls getModelStatus with the correct modelName', async () => {
    const event = createEvent({ modelName: 'custom-model-xyz' });
    await handler(event);

    expect(mockedGetModelStatus).toHaveBeenCalledWith('custom-model-xyz');
  });

  it('returns 403 when user role is REVIEWER', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when modelName path parameter is missing', async () => {
    const event = createEvent({ modelName: undefined });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('modelName パスパラメータは必須です。');
  });

  it('returns 404 when model is not found', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGetModelStatus.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: '指定されたカスタム言語モデルが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({ modelName: 'nonexistent-model' });
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('指定されたカスタム言語モデルが見つかりません。');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('allows TEAM_LEADER role to access', async () => {
    const event = createEvent({ role: 'TEAM_LEADER' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
  });

  it('returns 500 for unexpected errors', async () => {
    mockedGetModelStatus.mockRejectedValue(new Error('Transcribe API unavailable'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
