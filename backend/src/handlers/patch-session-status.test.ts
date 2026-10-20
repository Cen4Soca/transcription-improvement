import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './patch-session-status.js';


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

vi.mock('../services/session-service.js', () => ({
  changeSessionStatus: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { checkSessionAccess } from '../services/access-control-service.js';
import { changeSessionStatus } from '../services/session-service.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedChangeSessionStatus = vi.mocked(changeSessionStatus);

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    sessionId: string | null;
    body: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'user-001';
  const email = overrides.email ?? 'test@example.com';
  const role = overrides.role ?? 'REVIEWER';
  const displayName = overrides.displayName ?? 'Test User';
  const sessionId = overrides.sessionId === undefined ? 'session-001' : overrides.sessionId;
  const body = overrides.body === undefined ? JSON.stringify({ status: 'COMPLETED' }) : overrides.body;

  return {
    version: '2.0',
    routeKey: 'PATCH /sessions/{sessionId}/status',
    rawPath: `/sessions/${sessionId}/status`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: undefined,
    body: body ?? undefined,
    pathParameters: sessionId ? { sessionId } : undefined,
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
        path: `/sessions/${sessionId}/status`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'PATCH /sessions/{sessionId}/status',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleUpdatedSession = {
  sessionId: 'session-001',
  name: 'Meeting Transcription',
  status: 'COMPLETED' as const,
  assignedReviewerCount: 3,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('PATCH /sessions/{sessionId}/status handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful status update', () => {
    it('updates session status to COMPLETED', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      mockedChangeSessionStatus.mockResolvedValue(sampleUpdatedSession);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.status).toBe('COMPLETED');
      expect(body.data.sessionId).toBe('session-001');
      expect(mockedChangeSessionStatus).toHaveBeenCalledWith(
        'session-001',
        'COMPLETED'
      );
    });

    it('updates session status to IN_PROGRESS', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      mockedChangeSessionStatus.mockResolvedValue({
        ...sampleUpdatedSession,
        status: 'IN_PROGRESS',
      });

      const event = createEvent({
        body: JSON.stringify({ status: 'IN_PROGRESS' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.status).toBe('IN_PROGRESS');
      expect(mockedChangeSessionStatus).toHaveBeenCalledWith(
        'session-001',
        'IN_PROGRESS'
      );
    });
  });

  describe('Validation errors', () => {
    it('returns 400 when sessionId path parameter is missing', async () => {
      const event = createEvent({ sessionId: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('sessionId');
    });

    it('returns 400 when request body is empty', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);

      const event = createEvent({ body: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('status');
    });

    it('returns 400 when status field is missing from body', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);

      const event = createEvent({ body: JSON.stringify({}) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('status');
    });

    it('returns 400 when status is invalid (service throws)', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      const { AppError } = await import('../utils/error-handler.js');
      mockedChangeSessionStatus.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: 'status は PENDING, IN_PROGRESS, COMPLETED のいずれかを指定してください。',
          statusCode: 400,
        })
      );

      const event = createEvent({
        body: JSON.stringify({ status: 'INVALID' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when session is not found (service throws)', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      const { AppError } = await import('../utils/error-handler.js');
      mockedChangeSessionStatus.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: '指定されたセッションが見つかりません。',
          statusCode: 400,
        })
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('見つかりません');
    });

    it('returns 400 when transition is not allowed (service throws)', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      const { AppError } = await import('../utils/error-handler.js');
      mockedChangeSessionStatus.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: '現在のステータス「COMPLETED」から「COMPLETED」への変更はできません。',
          statusCode: 400,
        })
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('変更はできません');
    });
  });

  describe('Access control', () => {
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
  });

  describe('Error handling', () => {
    it('returns 500 when DynamoDB update fails', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      mockedChangeSessionStatus.mockRejectedValue(
        new Error('DynamoDB write failed')
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe(
        'セッションステータスの更新に失敗しました。'
      );
      expect(body.error.details).toBe('DynamoDB write failed');
    });
  });
});
