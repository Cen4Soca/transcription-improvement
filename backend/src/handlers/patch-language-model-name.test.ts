import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './patch-language-model-name.js';

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

import type { LanguageModelMetadata } from '../types/index.js';

vi.mock('../services/language-model-service.js', () => ({
  renameModelDisplayName: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { renameModelDisplayName } from '../services/language-model-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedRenameModelDisplayName = vi.mocked(renameModelDisplayName);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    modelName: string | null;
    body: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'leader-001';
  const email = overrides.email ?? 'leader@example.com';
  const role = overrides.role ?? 'TEAM_LEADER';
  const displayName = overrides.displayName ?? 'Leader User';
  const modelName = overrides.modelName === undefined ? 'model-001' : overrides.modelName;
  const body =
    overrides.body === undefined ? JSON.stringify({ name: '新しい表示名' }) : overrides.body;

  return {
    version: '2.0',
    routeKey: 'PATCH /language-models/{modelName}/name',
    rawPath: `/language-models/${modelName}/name`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: undefined,
    body: body ?? undefined,
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
        method: 'PATCH',
        path: `/language-models/${modelName}/name`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'PATCH /language-models/{modelName}/name',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleUpdatedModel: LanguageModelMetadata = {
  modelName: 'model-001',
  teamId: 'team-001',
  displayName: '新しい表示名',
  displayNameLower: '新しい表示名',
  baseModelName: 'WideBand',
  createdBy: 'leader-001',
  createdAt: '2024-01-01T00:00:00.000Z',
  sessionIds: [],
  s3Key: 'training-data/model-001/training.txt',
  deletionStatus: 'ACTIVE',
};

describe('PATCH /language-models/{modelName}/name handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful name update', () => {
    it('updates the display name and records an audit log', async () => {
      mockedRenameModelDisplayName.mockResolvedValue(sampleUpdatedModel);
      mockedRecordAuditLog.mockResolvedValue(undefined);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.displayName).toBe('新しい表示名');
      expect(body.data.modelName).toBe('model-001');
      expect(mockedRenameModelDisplayName).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'leader-001', role: 'TEAM_LEADER' }),
        'model-001',
        '新しい表示名'
      );
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'LANGUAGE_MODEL_NAME_CHANGED',
          resourceId: 'model-001',
          resourceType: 'LanguageModel',
          metadata: { displayName: '新しい表示名' },
        })
      );
    });

    it('passes the raw (untrimmed) name through to the service', async () => {
      mockedRenameModelDisplayName.mockResolvedValue(sampleUpdatedModel);
      mockedRecordAuditLog.mockResolvedValue(undefined);

      const event = createEvent({ body: JSON.stringify({ name: '  新しい表示名  ' }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockedRenameModelDisplayName).toHaveBeenCalledWith(
        expect.anything(),
        'model-001',
        '  新しい表示名  '
      );
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
    });

    it('returns 400 when request body is empty', async () => {
      const event = createEvent({ body: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('name');
    });

    it('returns 400 when name field is missing from body', async () => {
      const event = createEvent({ body: JSON.stringify({}) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('name');
    });

    it('returns 400 when name is not a string', async () => {
      const event = createEvent({ body: JSON.stringify({ name: 123 }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('name');
    });

    it('returns 400 when name is only whitespace (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedRenameModelDisplayName.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: 'Display name is required.',
          statusCode: 400,
        })
      );

      const event = createEvent({ body: JSON.stringify({ name: '   ' }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when displayName duplicates within the team (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedRenameModelDisplayName.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: 'チーム内に同じ表示名のモデルが既に存在します。別の表示名を指定してください。',
          statusCode: 400,
        })
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('Access control', () => {
    it('returns 404 when the model is inaccessible (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedRenameModelDisplayName.mockRejectedValue(
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
      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    it('returns 403 when the caller is below TEAM_LEADER (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedRenameModelDisplayName.mockRejectedValue(
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
  });

  describe('Error handling', () => {
    it('returns 500 when the service throws a raw error', async () => {
      mockedRenameModelDisplayName.mockRejectedValue(new Error('DynamoDB write failed'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('モデル表示名の更新に失敗しました。');
      expect(body.error.details).toBe('DynamoDB write failed');
    });
  });
});
