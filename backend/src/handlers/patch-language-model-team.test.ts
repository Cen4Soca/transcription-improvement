import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './patch-language-model-team.js';

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

import type { ChangeModelTeamResult } from '../services/language-model-service.js';

vi.mock('../services/language-model-service.js', () => ({
  changeModelTeam: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { changeModelTeam } from '../services/language-model-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedChangeModelTeam = vi.mocked(changeModelTeam);
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
  const userId = overrides.userId ?? 'admin-001';
  const email = overrides.email ?? 'admin@example.com';
  const role = overrides.role ?? 'ADMIN';
  const displayName = overrides.displayName ?? 'Admin User';
  const modelName = overrides.modelName === undefined ? 'model-001' : overrides.modelName;
  const body =
    overrides.body === undefined ? JSON.stringify({ teamId: 'team-002' }) : overrides.body;

  return {
    version: '2.0',
    routeKey: 'PATCH /language-models/{modelName}/team',
    rawPath: `/language-models/${modelName}/team`,
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
        path: `/language-models/${modelName}/team`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'PATCH /language-models/{modelName}/team',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleResult: ChangeModelTeamResult = {
  oldTeamId: 'team-001',
  newTeamId: 'team-002',
  modelName: 'model-001',
  teamId: 'team-002',
  displayName: 'Model X',
  displayNameLower: 'model x',
  baseModelName: 'WideBand',
  createdBy: 'admin-001',
  createdAt: '2024-01-01T00:00:00.000Z',
  sessionIds: [],
  s3Key: 'training-data/model-001/training.txt',
  deletionStatus: 'ACTIVE',
};

describe('PATCH /language-models/{modelName}/team handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful team change', () => {
    it('changes the team and records an audit log with old/new teamId', async () => {
      mockedChangeModelTeam.mockResolvedValue(sampleResult);
      mockedRecordAuditLog.mockResolvedValue(undefined);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.teamId).toBe('team-002');
      expect(body.data.oldTeamId).toBe('team-001');
      expect(body.data.newTeamId).toBe('team-002');
      expect(mockedChangeModelTeam).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-001', role: 'ADMIN' }),
        'model-001',
        'team-002'
      );
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'LANGUAGE_MODEL_TEAM_CHANGED',
          resourceId: 'model-001',
          resourceType: 'LanguageModel',
          metadata: { oldTeamId: 'team-001', newTeamId: 'team-002' },
        })
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
      expect(body.error.message).toContain('teamId');
    });

    it('returns 400 when teamId field is missing from body', async () => {
      const event = createEvent({ body: JSON.stringify({}) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('teamId');
    });

    it('returns 400 when teamId is not a string', async () => {
      const event = createEvent({ body: JSON.stringify({ teamId: 123 }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('teamId');
    });

    it('returns 400 when the destination team does not exist (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedChangeModelTeam.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: '指定されたチームが存在しません。',
          statusCode: 400,
        })
      );

      const event = createEvent({ body: JSON.stringify({ teamId: 'ghost-team' }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    it('returns 400 when the destination team has a displayName collision (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedChangeModelTeam.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: '移動先のチームに同じ表示名のモデルが既に存在します。先に表示名を変更してください。',
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
    it('returns 403 when the caller is not an ADMIN (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedChangeModelTeam.mockRejectedValue(
        new AppError({
          code: 'FORBIDDEN',
          message: 'この操作を実行する権限がありません。',
          statusCode: 403,
        })
      );

      const event = createEvent({ role: 'TEAM_LEADER' });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    it('returns 404 when the model does not exist (service throws)', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedChangeModelTeam.mockRejectedValue(
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
  });

  describe('Error handling', () => {
    it('returns 500 when the service throws a raw error', async () => {
      mockedChangeModelTeam.mockRejectedValue(new Error('DynamoDB update failed'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('モデルのチーム変更に失敗しました。');
      expect(body.error.details).toBe('DynamoDB update failed');
    });
  });
});
