import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './delete-language-model.js';

vi.mock('../services/language-model-service.js', () => ({
  deleteModel: vi.fn(),
}));

import { deleteModel } from '../services/language-model-service.js';

const mockedDeleteModel = vi.mocked(deleteModel);

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    modelName: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'leader-001';
  const email = overrides.email ?? 'leader@example.com';
  const role = overrides.role ?? 'TEAM_LEADER';
  const displayName = overrides.displayName ?? 'Leader User';
  const modelName = overrides.modelName === undefined ? 'model-001' : overrides.modelName;

  return {
    version: '2.0',
    routeKey: 'DELETE /language-models/{modelName}',
    rawPath: `/language-models/${modelName}`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: undefined,
    body: undefined,
    pathParameters: modelName ? { modelName } : undefined,
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
        method: 'DELETE',
        path: `/language-models/${modelName}`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'DELETE /language-models/{modelName}',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('DELETE /language-models/{modelName} handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy path', () => {
    it('deletes the model and returns { deleted: true }', async () => {
      mockedDeleteModel.mockResolvedValue(undefined);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.deleted).toBe(true);
      expect(mockedDeleteModel).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'leader-001', role: 'TEAM_LEADER' }),
        'model-001'
      );
    });

    it('is idempotent on re-run: a second delete of the same model still succeeds', async () => {
      mockedDeleteModel.mockResolvedValue(undefined);

      const event = createEvent();
      const first = await handler(event);
      const second = await handler(event);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body as string).data.deleted).toBe(true);
      expect(mockedDeleteModel).toHaveBeenCalledTimes(2);
    });
  });

  describe('Validation errors', () => {
    it('returns 400 when modelName path parameter is missing', async () => {
      const event = createEvent({ modelName: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('modelName');
      expect(mockedDeleteModel).not.toHaveBeenCalled();
    });
  });

  describe('Eligibility rejection', () => {
    it('returns 400 when the model is still training (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedDeleteModel.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: 'モデルの学習が進行中のため削除できません。学習の完了後に再度お試しください。',
          statusCode: 400,
        })
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when an in-progress job references the model (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedDeleteModel.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message:
            '実行中の文字起こしジョブがこのモデルを使用しているため削除できません。ジョブの完了後に再度お試しください。',
          statusCode: 400,
        })
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Access control', () => {
    it('returns 403 when the caller is a REVIEWER (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedDeleteModel.mockRejectedValue(
        new AppError({
          code: 'FORBIDDEN',
          message: 'この操作を実行する権限がありません。',
          statusCode: 403,
        })
      );

      const event = createEvent({ role: 'REVIEWER' });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 when the model is not visible to the caller (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedDeleteModel.mockRejectedValue(
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
  });

  describe('Error handling', () => {
    it('returns 500 when the service throws a raw error', async () => {
      mockedDeleteModel.mockRejectedValue(new Error('DynamoDB delete failed'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('モデルの削除に失敗しました。');
      expect(body.error.details).toBe('DynamoDB delete failed');
    });
  });
});
