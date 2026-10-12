import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-assigned-sessions.js';

vi.mock('../services/session-service.js', () => ({
  getAssignedSessions: vi.fn(),
}));

import { getAssignedSessions } from '../services/session-service.js';

const mockedGetAssignedSessions = vi.mocked(getAssignedSessions);

function createEvent(
  overrides: Partial<{ userId: string; role: string }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'reviewer-001';
  const role = overrides.role ?? 'REVIEWER';
  return {
    version: '2.0',
    routeKey: 'GET /sessions/assigned',
    rawPath: '/sessions/assigned',
    rawQueryString: '',
    headers: {},
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
      http: { method: 'GET', path: '/sessions/assigned', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey: 'GET /sessions/assigned',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sample = {
  sessionId: 'session-001',
  name: 'Assigned Session',
  status: 'PENDING' as const,
  assignedUserId: 'reviewer-001',
  assignedTeamId: 'team-001',
  assignedReviewerCount: 0,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('GET /sessions/assigned handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the caller assigned sessions', async () => {
    mockedGetAssignedSessions.mockResolvedValue([sample]);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].sessionId).toBe('session-001');
    expect(mockedGetAssignedSessions).toHaveBeenCalledWith('reviewer-001');
  });

  it('returns an empty list when nothing is assigned', async () => {
    mockedGetAssignedSessions.mockResolvedValue([]);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.items).toEqual([]);
  });

  it('returns 403 when the JWT sub claim is missing', async () => {
    const result = await handler(createEvent({ userId: '' }));
    expect(result.statusCode).toBe(403);
  });

  it('returns 500 when the service fails', async () => {
    mockedGetAssignedSessions.mockRejectedValue(new Error('boom'));

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
