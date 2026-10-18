import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './upload-url.js';

vi.mock('../services/upload-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/upload-service.js')>();
  return {
    ...actual,
    generatePresignedUrl: vi.fn(),
    generateMediaFileId: actual.generateMediaFileId,
  };
});

// The handler pre-creates a MediaFile record; mock the repository so no real
// DynamoDB call is made during the unit test.
vi.mock('../repositories/media-file-repository.js', () => ({
  save: vi.fn().mockResolvedValue(undefined),
}));

import { generatePresignedUrl } from '../services/upload-service.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';

const mockedSave = vi.mocked(mediaFileRepository.save);

const mockedGeneratePresignedUrl = vi.mocked(generatePresignedUrl);

function createEvent(
  overrides: Partial<{
    body: string | undefined;
    userId: string;
    email: string;
    role: string;
    displayName: string;
    teamId: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    body = JSON.stringify({
      filename: 'recording.mp3',
      contentType: 'audio/mpeg',
      fileSize: 1048576,
    }),
    userId = 'user-001',
    email = 'test@example.com',
    role = 'REVIEWER',
    displayName = 'Test User',
    teamId = undefined,
  } = overrides;

  const claims: Record<string, unknown> = {
    sub: userId,
    email,
    'custom:role': role,
    'custom:displayName': displayName,
  };

  if (teamId) {
    claims['custom:teamId'] = teamId;
  }

  return {
    version: '2.0',
    routeKey: 'POST /upload-url',
    rawPath: '/upload-url',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    body,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims,
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'POST',
        path: '/upload-url',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'POST /upload-url',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('POST /upload-url handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGeneratePresignedUrl.mockResolvedValue({
      presignedUrl: 'https://s3.amazonaws.com/bucket/media/uuid/recording.mp3?signed',
      mediaFileId: 'test-uuid',
      s3Key: 'media/test-uuid/recording.mp3',
      expiresAt: '2024-01-15T11:30:00.000Z',
    });
  });

  it('returns 200 with presigned URL for a valid request', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.presignedUrl).toBeDefined();
    expect(body.mediaFileId).toBeDefined();
    expect(body.s3Key).toBeDefined();
    expect(body.expiresAt).toBeDefined();
  });

  it('pre-creates the MediaFile record with the uploader recorded', async () => {
    const event = createEvent({ userId: 'user-042', teamId: 'team-001' });
    await handler(event);

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadedBy: 'user-042',
        teamId: 'team-001',
        status: 'UPLOADING',
        scanStatus: 'PENDING',
      })
    );
  });

  it('calls generatePresignedUrl with correct parameters', async () => {
    const event = createEvent({ teamId: 'team-001' });
    await handler(event);

    expect(mockedGeneratePresignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'recording.mp3',
        contentType: 'audio/mpeg',
        userId: 'user-001',
        teamId: 'team-001',
      })
    );
    // mediaFileId should be a UUID
    const callArgs = mockedGeneratePresignedUrl.mock.calls[0][0];
    expect(callArgs.mediaFileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('returns 400 when request body is missing', async () => {
    const event = createEvent();
    // Simulate missing body (API Gateway sends undefined for no body)
    (event as Record<string, unknown>).body = undefined;
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const respBody = JSON.parse(result.body as string);
    expect(respBody.error.code).toBe('VALIDATION_ERROR');
    expect(respBody.error.message).toBe('リクエストボディが必要です。');
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const event = createEvent({ body: 'not-json' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('リクエストボディのJSON形式が不正です。');
  });

  it('returns 400 when filename is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ contentType: 'audio/mpeg', fileSize: 1048576 }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('filename は必須です。');
  });

  it('returns 400 when contentType is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ filename: 'test.mp3', fileSize: 1048576 }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('contentType は必須です。');
  });

  it('returns 400 when fileSize is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ filename: 'test.mp3', contentType: 'audio/mpeg' }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('fileSize は必須です。');
  });

  it('returns 400 with UNSUPPORTED_FILE_FORMAT for invalid file extension', async () => {
    const event = createEvent({
      body: JSON.stringify({
        filename: 'document.pdf',
        contentType: 'application/pdf',
        fileSize: 1048576,
      }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('UNSUPPORTED_FILE_FORMAT');
    expect(body.error.message).toContain('サポートされていないファイル形式');
    expect(body.error.supportedFormats).toEqual([
      'mp3', 'wav', 'flac', 'ogg', 'm4a', 'amr', 'webm',
      'mp4', 'mkv', 'avi', 'mov',
    ]);
  });

  it('returns 400 with FILE_SIZE_EXCEEDED for files over 2GB', async () => {
    const event = createEvent({
      body: JSON.stringify({
        filename: 'large.mp3',
        contentType: 'audio/mpeg',
        fileSize: 2 * 1024 * 1024 * 1024 + 1,
      }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FILE_SIZE_EXCEEDED');
    expect(body.error.message).toContain('2GB');
    expect(body.error.maxFileSize).toBe('2GB');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('passes teamId as undefined when not in JWT claims', async () => {
    const event = createEvent();
    await handler(event);

    const callArgs = mockedGeneratePresignedUrl.mock.calls[0][0];
    expect(callArgs.teamId).toBeUndefined();
  });

  it('returns 500 when generatePresignedUrl throws', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGeneratePresignedUrl.mockRejectedValue(
      new AppError({
        code: 'CONFIGURATION_ERROR',
        message: 'メディアバケットの設定が不足しています。',
        statusCode: 500,
        details: 'MEDIA_BUCKET_NAME environment variable is not set',
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('CONFIGURATION_ERROR');
  });
});
