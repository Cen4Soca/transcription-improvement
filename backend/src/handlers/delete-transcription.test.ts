import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './delete-transcription.js';


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

vi.mock('../services/deletion-service.js', () => ({
  deleteTranscription: vi.fn(),
}));

import { deleteTranscription } from '../services/deletion-service.js';

const mockedDeleteTranscription = vi.mocked(deleteTranscription);

function createEvent(
  overrides: Partial<{
    sessionId: string | undefined;
    userId: string;
    role: string;
    teamId: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const sessionId = 'sessionId' in overrides ? overrides.sessionId : 'session-001';
  const userId = overrides.userId ?? 'user-001';
  const role = overrides.role ?? 'TEAM_LEADER';
  const teamId = 'teamId' in overrides ? overrides.teamId : 'team-001';

  return {
    version: '2.0',
    routeKey: 'DELETE /sessions/{sessionId}/transcription',
    rawPath: `/sessions/${sessionId ?? ''}/transcription`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    pathParameters: sessionId ? { sessionId } : undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'test@example.com',
            'custom:role': role,
            'custom:displayName': 'Test User',
            'custom:teamId': teamId,
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'DELETE',
        path: `/sessions/${sessionId ?? ''}/transcription`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'DELETE /sessions/{sessionId}/transcription',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('DELETE /sessions/{sessionId}/transcription handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDeleteTranscription.mockResolvedValue(undefined);
  });

  it('returns 200 on successful deletion', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.message).toBe('Transcription を削除しました。');
    expect(mockedDeleteTranscription).toHaveBeenCalledWith({
      sessionId: 'session-001',
      userId: 'user-001',
      userRole: 'TEAM_LEADER',
      userTeamId: 'team-001',
    });
  });

  it('returns 403 when user role is REVIEWER', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when sessionId path parameter is missing', async () => {
    const event = createEvent({ sessionId: undefined });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('sessionId');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when DeletionService throws NOT_FOUND', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedDeleteTranscription.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: '指定された ReviewSession が見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 when an unexpected error occurs', async () => {
    mockedDeleteTranscription.mockRejectedValue(new Error('DynamoDB timeout'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes Admin role correctly to DeletionService', async () => {
    const event = createEvent({ role: 'ADMIN', teamId: undefined });
    await handler(event);

    expect(mockedDeleteTranscription).toHaveBeenCalledWith({
      sessionId: 'session-001',
      userId: 'user-001',
      userRole: 'ADMIN',
      userTeamId: undefined,
    });
  });
});
