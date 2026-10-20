import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './post-session-reopen.js';

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

import { forbiddenError, notFoundError, validationError } from '../utils/error-handler.js';

vi.mock('../services/session-service.js', () => ({
  reopenSession: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { reopenSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedReopenSession = vi.mocked(reopenSession);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

function createEvent(
  overrides: Partial<{ userId: string; role: string; sessionId: string | null }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'admin-001';
  const role = overrides.role ?? 'ADMIN';
  const sessionId = overrides.sessionId === undefined ? 'session-001' : overrides.sessionId;
  return {
    version: '2.0',
    routeKey: 'POST /sessions/{sessionId}/reopen',
    rawPath: `/sessions/${sessionId}/reopen`,
    rawQueryString: '',
    headers: {},
    pathParameters: sessionId ? { sessionId } : undefined,
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'a@example.com',
            'custom:role': role,
            'custom:displayName': 'A',
          },
          scopes: [],
        },
      },
      http: {
        method: 'POST',
        path: `/sessions/${sessionId}/reopen`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req',
      routeKey: 'POST /sessions/{sessionId}/reopen',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const reopenedSession = {
  sessionId: 'session-001',
  name: 'Session',
  status: 'IN_PROGRESS' as const,
  assignedTeamId: 'team-001',
  assignedReviewerCount: 2,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('POST /sessions/{sessionId}/reopen handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reopens the session and records SESSION_REOPENED exactly once', async () => {
    mockedReopenSession.mockResolvedValue(reopenedSession);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toEqual({ sessionId: 'session-001', status: 'IN_PROGRESS' });
    expect(mockedReopenSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-001', role: 'ADMIN' }),
      'session-001'
    );
    expect(mockedRecordAuditLog).toHaveBeenCalledTimes(1);
    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'SESSION_REOPENED',
        resourceId: 'session-001',
        resourceType: 'ReviewSession',
      })
    );
  });

  it('returns 400 when sessionId is missing', async () => {
    const result = await handler(createEvent({ sessionId: null }));
    expect(result.statusCode).toBe(400);
    expect(mockedReopenSession).not.toHaveBeenCalled();
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });

  it('surfaces a 403 service error via errorResponse', async () => {
    mockedReopenSession.mockRejectedValue(
      forbiddenError('自チームのセッションのみ操作できます。')
    );

    const result = await handler(
      createEvent({ userId: 'leader-001', role: 'TEAM_LEADER' })
    );

    expect(result.statusCode).toBe(403);
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });

  it('surfaces a 404 service error via errorResponse', async () => {
    mockedReopenSession.mockRejectedValue(
      notFoundError('指定されたセッションが見つかりません。')
    );

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(404);
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });

  it('surfaces a 400 service error via errorResponse', async () => {
    mockedReopenSession.mockRejectedValue(
      validationError('完了していないセッションは差し戻しできません。')
    );

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(400);
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });
});
