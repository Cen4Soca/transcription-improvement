import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './create-language-model.js';

vi.mock('../services/language-model-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/language-model-service.js')>();
  return {
    ...actual,
    createModel: vi.fn(),
  };
});

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: vi.fn().mockResolvedValue({ Items: [] }) },
  TABLE_NAME: 'TestTable',
}));

import { createModel } from '../services/language-model-service.js';
import { docClient } from '../utils/dynamodb-client.js';

const mockedCreateModel = vi.mocked(createModel);
const mockedDocClientSend = vi.mocked(docClient.send);

function createEvent(
  overrides: Partial<{
    body: string | undefined;
    userId: string;
    role: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'user-001',
    role = 'ADMIN',
  } = overrides;

  const body = 'body' in overrides
    ? overrides.body
    : JSON.stringify({
        modelName: 'my-custom-model',
        baseModelName: 'WideBand',
        sessionIds: ['session-001', 'session-002'],
      });

  return {
    version: '2.0',
    routeKey: 'POST /language-models',
    rawPath: '/language-models',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
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
        method: 'POST',
        path: '/language-models',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'POST /language-models',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('POST /language-models handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock DynamoDB query for fetching confirmed segments
    mockedDocClientSend.mockResolvedValue({
      Items: [
        { originalText: 'テスト文章1', consensusStatus: 'CONFIRMED', consensusText: '確定テキスト1' },
        { originalText: 'テスト文章2', consensusStatus: 'CONFIRMED', consensusText: '確定テキスト2' },
      ],
    } as any);

    mockedCreateModel.mockResolvedValue({
      modelName: 'my-custom-model',
      baseModelName: 'WideBand',
      status: 'IN_PROGRESS',
      trainingDataS3Uri: 's3://test-data-bucket/training-data/my-custom-model/training.txt',
      createdBy: 'user-001',
      createdAt: '2024-01-15T10:30:00.000Z',
    });
  });

  it('returns 200 with model record for a valid request', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.modelName).toBe('my-custom-model');
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.baseModelName).toBe('WideBand');
  });

  it('passes sessionIds to createModel', async () => {
    const event = createEvent();
    await handler(event);

    expect(mockedCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionIds: ['session-001', 'session-002'],
      })
    );
  });

  it('returns 403 when user role is REVIEWER', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when request body is missing', async () => {
    const event = createEvent({ body: undefined });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('リクエストボディが必要です。');
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const event = createEvent({ body: 'not-json' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('リクエストボディのJSON形式が不正です。');
  });

  it('returns 400 when modelName is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ baseModelName: 'WideBand', sessionIds: ['s1'] }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('modelName は必須です。');
  });

  it('returns 400 when baseModelName is invalid', async () => {
    const event = createEvent({
      body: JSON.stringify({ modelName: 'test', baseModelName: 'Invalid', sessionIds: ['s1'] }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('NarrowBand');
  });

  it('returns 400 when sessionIds is empty', async () => {
    const event = createEvent({
      body: JSON.stringify({ modelName: 'test', baseModelName: 'WideBand', sessionIds: [] }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns error when createModel throws duplicate model error', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedCreateModel.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'モデル名が重複しています。別のモデル名を指定してください。',
        statusCode: 400,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('モデル名が重複');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
