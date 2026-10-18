import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './delete-media.js';

vi.mock('../services/deletion-service.js', () => ({
  deleteMediaFile: vi.fn(),
}));

import { deleteMediaFile } from '../services/deletion-service.js';

const mockedDeleteMediaFile = vi.mocked(deleteMediaFile);

function createEvent(
  overrides: Partial<{
    mediaFileId: string | undefined;
    userId: string;
    role: string;
    teamId: string | undefined;
    force: boolean;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const mediaFileId = 'mediaFileId' in overrides ? overrides.mediaFileId : 'media-001';
  const userId = overrides.userId ?? 'user-001';
  const role = overrides.role ?? 'TEAM_LEADER';
  const teamId = 'teamId' in overrides ? overrides.teamId : 'team-001';
  const force = overrides.force ?? false;

  return {
    version: '2.0',
    routeKey: 'DELETE /media-files/{mediaFileId}',
    rawPath: `/media-files/${mediaFileId ?? ''}`,
    rawQueryString: force ? 'force=true' : '',
    queryStringParameters: force ? { force: 'true' } : undefined,
    headers: { 'content-type': 'application/json' },
    pathParameters: mediaFileId ? { mediaFileId } : undefined,
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
        path: `/media-files/${mediaFileId ?? ''}`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'DELETE /media-files/{mediaFileId}',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('DELETE /media-files/{mediaFileId} handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDeleteMediaFile.mockResolvedValue(undefined);
  });

  it('returns 200 on successful deletion', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.message).toBe('メディアファイルを削除しました。');
    expect(mockedDeleteMediaFile).toHaveBeenCalledWith({
      mediaFileId: 'media-001',
      user: expect.objectContaining({
        userId: 'user-001',
        role: 'TEAM_LEADER',
      }),
      force: false,
    });
  });

  it('allows REVIEWER to reach the service (access control enforced in service)', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await handler(event);

    // The handler no longer rejects REVIEWER by role; the service performs the
    // uploadedBy-based access check. On success it returns 200.
    expect(result.statusCode).toBe(200);
    expect(mockedDeleteMediaFile).toHaveBeenCalledWith({
      mediaFileId: 'media-001',
      user: expect.objectContaining({
        userId: 'user-001',
        role: 'REVIEWER',
      }),
      force: false,
    });
  });

  it('passes force=true when the force query parameter is set', async () => {
    const event = createEvent({ force: true });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockedDeleteMediaFile).toHaveBeenCalledWith({
      mediaFileId: 'media-001',
      user: expect.objectContaining({ userId: 'user-001' }),
      force: true,
    });
  });

  it('returns 400 when mediaFileId path parameter is missing', async () => {
    const event = createEvent({ mediaFileId: undefined });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('mediaFileId');
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
    mockedDeleteMediaFile.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: '指定されたメディアファイルが見つかりません。',
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
    mockedDeleteMediaFile.mockRejectedValue(new Error('S3 connection failed'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes Admin user correctly to DeletionService', async () => {
    const event = createEvent({ role: 'ADMIN', teamId: undefined });
    await handler(event);

    expect(mockedDeleteMediaFile).toHaveBeenCalledWith({
      mediaFileId: 'media-001',
      user: expect.objectContaining({
        userId: 'user-001',
        role: 'ADMIN',
      }),
      force: false,
    });
  });
});
