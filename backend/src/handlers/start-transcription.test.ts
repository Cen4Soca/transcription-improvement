import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './start-transcription.js';

vi.mock('../services/transcription-job-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/transcription-job-service.js')>();
  return {
    ...actual,
    startJob: vi.fn(),
  };
});

import { startJob } from '../services/transcription-job-service.js';

const mockedStartJob = vi.mocked(startJob);

function createEvent(
  overrides: Partial<{
    body: string | undefined;
    userId: string;
    email: string;
    role: string;
    displayName: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'user-001',
    email = 'test@example.com',
    role = 'REVIEWER',
    displayName = 'Test User',
  } = overrides;

  const body = 'body' in overrides
    ? overrides.body
    : JSON.stringify({
        mediaFileId: 'media-file-001',
        maxSpeakerLabels: 3,
        languageCode: 'ja-JP',
        languageModelName: 'my-custom-model',
      });

  return {
    version: '2.0',
    routeKey: 'POST /transcription-jobs',
    rawPath: '/transcription-jobs',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    body,
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
        method: 'POST',
        path: '/transcription-jobs',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'POST /transcription-jobs',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('POST /transcription-jobs handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStartJob.mockResolvedValue({
      jobId: 'job-001',
      transcribeJobName: 'tr-uuid-001',
      mediaFileId: 'media-file-001',
      status: 'IN_PROGRESS',
      languageCode: 'ja-JP',
      maxSpeakerLabels: 3,
      languageModelName: 'my-custom-model',
      outputS3Key: 'transcriptions/job-001/output.json',
      startedBy: 'user-001',
      createdAt: '2024-01-15T10:30:00.000Z',
      updatedAt: '2024-01-15T10:30:00.000Z',
    });
  });

  it('returns 200 with job record for a valid request', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.jobId).toBe('job-001');
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.mediaFileId).toBe('media-file-001');
    expect(body.languageCode).toBe('ja-JP');
    expect(body.maxSpeakerLabels).toBe(3);
    expect(body.languageModelName).toBe('my-custom-model');
  });

  it('calls startJob with correct parameters', async () => {
    const event = createEvent();
    await handler(event);

    expect(mockedStartJob).toHaveBeenCalledWith({
      mediaFileId: 'media-file-001',
      maxSpeakerLabels: 3,
      languageCode: 'ja-JP',
      languageModelName: 'my-custom-model',
      user: {
        userId: 'user-001',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'REVIEWER',
      },
    });
  });

  it('passes optional parameters as undefined when not provided', async () => {
    const event = createEvent({
      body: JSON.stringify({ mediaFileId: 'media-file-002' }),
    });
    await handler(event);

    expect(mockedStartJob).toHaveBeenCalledWith({
      mediaFileId: 'media-file-002',
      maxSpeakerLabels: undefined,
      languageCode: undefined,
      languageModelName: undefined,
      user: {
        userId: 'user-001',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'REVIEWER',
      },
    });
  });

  it('returns 400 when request body is missing', async () => {
    const event = createEvent({ body: undefined });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('リクエストボディが必要です。');
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const event = createEvent({ body: 'not-json' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('リクエストボディのJSON形式が不正です。');
  });

  it('returns 400 when mediaFileId is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ maxSpeakerLabels: 3 }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('mediaFileId は必須です。');
  });

  it('returns 400 when maxSpeakerLabels is not a number', async () => {
    const event = createEvent({
      body: JSON.stringify({ mediaFileId: 'media-001', maxSpeakerLabels: 'three' }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('maxSpeakerLabels は数値で指定してください。');
  });

  it('returns 400 when languageCode is not a string', async () => {
    const event = createEvent({
      body: JSON.stringify({ mediaFileId: 'media-001', languageCode: 123 }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('languageCode は文字列で指定してください。');
  });

  it('returns 400 when languageModelName is not a string', async () => {
    const event = createEvent({
      body: JSON.stringify({ mediaFileId: 'media-001', languageModelName: 123 }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('languageModelName は文字列で指定してください。');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns error when startJob throws a validation error', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedStartJob.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'MaxSpeakerLabels は 2〜10 の範囲で指定してください。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      body: JSON.stringify({ mediaFileId: 'media-001', maxSpeakerLabels: 15 }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when media file is not found', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedStartJob.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: '指定されたメディアファイルが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      body: JSON.stringify({ mediaFileId: 'nonexistent-id' }),
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
