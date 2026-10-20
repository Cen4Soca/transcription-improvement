import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-joinable-sessions.js';


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
  listJoinableSessions: vi.fn(),
}));

import { listJoinableSessions } from '../services/session-service.js';

const mockedListJoinableSessions = vi.mocked(listJoinableSessions);

function createEvent(
  overrides: Partial<{ userId: string; role: string }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'reviewer-001';
  const role = overrides.role ?? 'REVIEWER';
  return {
    version: '2.0',
    routeKey: 'GET /sessions/joinable',
    rawPath: '/sessions/joinable',
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
      http: { method: 'GET', path: '/sessions/joinable', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey: 'GET /sessions/joinable',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sample = {
  sessionId: 'session-001',
  name: 'Joinable Session',
  status: 'PENDING' as const,
  assignedTeamId: 'team-001',
  assignedReviewerCount: 0,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('GET /sessions/joinable handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the joinable candidate sessions', async () => {
    mockedListJoinableSessions.mockResolvedValue([sample]);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].sessionId).toBe('session-001');
    expect(mockedListJoinableSessions).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'reviewer-001' })
    );
  });

  it('returns an empty list when there are no candidates', async () => {
    mockedListJoinableSessions.mockResolvedValue([]);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.items).toEqual([]);
  });

  it('returns 403 when the JWT sub claim is missing', async () => {
    const result = await handler(createEvent({ userId: '' }));
    expect(result.statusCode).toBe(403);
  });

  it('returns 500 when the service throws a raw error', async () => {
    mockedListJoinableSessions.mockRejectedValue(new Error('boom'));

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('propagates an AppError status from the service instead of masking it as 500', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedListJoinableSessions.mockRejectedValue(
      new AppError({ code: 'FORBIDDEN', message: 'no', statusCode: 403 })
    );

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(403);
  });
});
