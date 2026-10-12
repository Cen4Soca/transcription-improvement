import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './patch-session-name.js';

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/session-service.js', () => ({
  renameSession: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { checkSessionAccess } from '../services/access-control-service.js';
import { renameSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedRenameSession = vi.mocked(renameSession);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

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
  const body = overrides.body === undefined ? JSON.stringify({ name: 'New Session Name' }) : overrides.body;

  return {
    version: '2.0',
    routeKey: 'PATCH /sessions/{sessionId}/name',
    rawPath: `/sessions/${sessionId}/name`,
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
        path: `/sessions/${sessionId}/name`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'PATCH /sessions/{sessionId}/name',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleUpdatedSession = {
  sessionId: 'session-001',
  name: 'New Session Name',
  status: 'IN_PROGRESS' as const,
  assignedReviewerCount: 3,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('PATCH /sessions/{sessionId}/name handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful name update', () => {
    it('updates session name and records an audit log', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      mockedRenameSession.mockResolvedValue(sampleUpdatedSession);
      mockedRecordAuditLog.mockResolvedValue(undefined);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.name).toBe('New Session Name');
      expect(body.data.sessionId).toBe('session-001');
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'SESSION_NAME_CHANGED',
          resourceId: 'session-001',
          resourceType: 'ReviewSession',
          metadata: { name: 'New Session Name' },
        })
      );
    });

    it('passes the raw (untrimmed) name through to renameSession', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      mockedRenameSession.mockResolvedValue(sampleUpdatedSession);
      mockedRecordAuditLog.mockResolvedValue(undefined);

      const event = createEvent({ body: JSON.stringify({ name: '  New Session Name  ' }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockedRenameSession).toHaveBeenCalledWith(
        'session-001',
        '  New Session Name  '
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
      expect(body.error.message).toContain('name');
    });

    it('returns 400 when name field is missing from body', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);

      const event = createEvent({ body: JSON.stringify({}) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('name');
    });

    it('returns 400 when name is not a string', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);

      const event = createEvent({ body: JSON.stringify({ name: 123 }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('name');
    });

    it('returns 400 when name is only whitespace (service throws)', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      const { AppError } = await import('../utils/error-handler.js');
      mockedRenameSession.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: 'Session name is required.',
          statusCode: 400,
        })
      );

      const event = createEvent({ body: JSON.stringify({ name: '   ' }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when name exceeds 100 characters (service throws)', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      const { AppError } = await import('../utils/error-handler.js');
      mockedRenameSession.mockRejectedValue(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: 'Session name must be between 1 and 100 characters.',
          statusCode: 400,
        })
      );

      const event = createEvent({ body: JSON.stringify({ name: 'a'.repeat(101) }) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Access control', () => {
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
    it('returns 500 when the service throws a raw error', async () => {
      mockedCheckSessionAccess.mockResolvedValue(undefined);
      mockedRenameSession.mockRejectedValue(new Error('DynamoDB write failed'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('セッション名の更新に失敗しました。');
      expect(body.error.details).toBe('DynamoDB write failed');
    });
  });
});
