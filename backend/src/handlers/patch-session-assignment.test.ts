import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './patch-session-assignment.js';


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

vi.mock('../services/session-service.js', () => ({
  assignSession: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { assignSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedAssignSession = vi.mocked(assignSession);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

function createEvent(
  overrides: Partial<{
    userId: string;
    role: string;
    sessionId: string | null;
    body: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'leader-001';
  const role = overrides.role ?? 'TEAM_LEADER';
  const sessionId = overrides.sessionId === undefined ? 'session-001' : overrides.sessionId;
  const body =
    overrides.body === undefined
      ? JSON.stringify({ assignedUserId: 'member-1' })
      : overrides.body;
  return {
    version: '2.0',
    routeKey: 'PATCH /sessions/{sessionId}/assignment',
    rawPath: `/sessions/${sessionId}/assignment`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    body: body ?? undefined,
    pathParameters: sessionId ? { sessionId } : undefined,
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'l@example.com',
            'custom:role': role,
            'custom:displayName': 'L',
          },
          scopes: [],
        },
      },
      http: { method: 'PATCH', path: `/sessions/${sessionId}/assignment`, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey: 'PATCH /sessions/{sessionId}/assignment',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const updated = {
  sessionId: 'session-001',
  name: 'Session',
  status: 'PENDING' as const,
  assignedUserId: 'member-1',
  assignedTeamId: 'team-001',
  assignedReviewerCount: 0,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('PATCH /sessions/{sessionId}/assignment handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns a session and records an audit log', async () => {
    mockedAssignSession.mockResolvedValue(updated);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.assignedUserId).toBe('member-1');
    expect(mockedAssignSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'leader-001', role: 'TEAM_LEADER' }),
      'session-001',
      { assignedUserId: 'member-1', assignedTeamId: undefined }
    );
    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'REVIEW_ASSIGNMENT_CHANGE',
        resourceId: 'session-001',
      })
    );
  });

  it('returns 400 when sessionId is missing', async () => {
    const result = await handler(createEvent({ sessionId: null }));
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when neither target is provided', async () => {
    const result = await handler(createEvent({ body: JSON.stringify({}) }));
    expect(result.statusCode).toBe(400);
    expect(mockedAssignSession).not.toHaveBeenCalled();
  });

  it('propagates 403 from the service (reviewer or out-of-scope leader)', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedAssignSession.mockRejectedValue(
      new AppError({ code: 'FORBIDDEN', message: 'x', statusCode: 403 })
    );

    const result = await handler(createEvent({ role: 'REVIEWER' }));

    expect(result.statusCode).toBe(403);
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    mockedAssignSession.mockRejectedValue(new Error('boom'));

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(500);
  });
});
