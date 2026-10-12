import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './post-session-join.js';

vi.mock('../services/session-service.js', () => ({
  joinSession: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { joinSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedJoinSession = vi.mocked(joinSession);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

function createEvent(
  overrides: Partial<{ userId: string; role: string; sessionId: string | null }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'reviewer-001';
  const role = overrides.role ?? 'REVIEWER';
  const sessionId = overrides.sessionId === undefined ? 'session-001' : overrides.sessionId;
  return {
    version: '2.0',
    routeKey: 'POST /sessions/{sessionId}/join',
    rawPath: `/sessions/${sessionId}/join`,
    rawQueryString: '',
    headers: {},
    pathParameters: sessionId ? { sessionId } : undefined,
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'r@example.com',
            'custom:role': role,
            'custom:displayName': 'R',
          },
          scopes: [],
        },
      },
      http: { method: 'POST', path: `/sessions/${sessionId}/join`, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey: 'POST /sessions/{sessionId}/join',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const joined = {
  sessionId: 'session-001',
  name: 'Session',
  status: 'IN_PROGRESS' as const,
  assignedTeamId: 'team-001',
  assignedReviewerCount: 2,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('POST /sessions/{sessionId}/join handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins a session and records an audit log', async () => {
    mockedJoinSession.mockResolvedValue(joined);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.sessionId).toBe('session-001');
    expect(body.data.assignedReviewerCount).toBe(2);
    expect(mockedJoinSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'reviewer-001' }),
      'session-001'
    );
    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: 'REVIEW_ASSIGNMENT_CHANGE' })
    );
  });

  it('returns 400 when sessionId is missing', async () => {
    const result = await handler(createEvent({ sessionId: null }));
    expect(result.statusCode).toBe(400);
    expect(mockedJoinSession).not.toHaveBeenCalled();
  });

  it('returns 403 when the reviewer is not in the session team', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedJoinSession.mockRejectedValue(
      new AppError({ code: 'FORBIDDEN', message: 'no', statusCode: 403 })
    );

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(403);
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });

  it('returns 404 when the session does not exist', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedJoinSession.mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'missing', statusCode: 404 })
    );

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockedJoinSession.mockRejectedValue(new Error('boom'));

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(500);
  });
});
