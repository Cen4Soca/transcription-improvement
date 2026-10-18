import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-job-status.js';

vi.mock('../services/transcription-job-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/transcription-job-service.js')>();
  return {
    ...actual,
    getJobStatusFromTranscribe: vi.fn(),
  };
});

import { getJobStatusFromTranscribe } from '../services/transcription-job-service.js';

const mockedGetJobStatusFromTranscribe = vi.mocked(getJobStatusFromTranscribe);

function createEvent(
  overrides: Partial<{
    jobId: string | undefined;
    userId: string;
    role: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const jobId = 'jobId' in overrides ? overrides.jobId : 'job-001';
  const {
    userId = 'user-001',
    role = 'REVIEWER',
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /transcription-jobs/{jobId}',
    rawPath: `/transcription-jobs/${jobId ?? ''}`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    pathParameters: jobId ? { jobId } : undefined,
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
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: `/transcription-jobs/${jobId ?? ''}`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /transcription-jobs/{jobId}',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /transcription-jobs/{jobId} handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetJobStatusFromTranscribe.mockResolvedValue({
      jobId: 'job-001',
      transcribeJobName: 'tr-uuid-001',
      mediaFileId: 'media-file-001',
      status: 'IN_PROGRESS',
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
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
    expect(body.maxSpeakerLabels).toBe(2);
  });

  it('calls getJobStatusFromTranscribe with the correct jobId', async () => {
    const event = createEvent({ jobId: 'job-xyz' });
    await handler(event);

    expect(mockedGetJobStatusFromTranscribe).toHaveBeenCalledWith('job-xyz');
  });

  it('returns 400 when jobId path parameter is missing', async () => {
    const event = createEvent({ jobId: undefined });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('jobId パスパラメータは必須です。');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });
    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when job is not found', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGetJobStatusFromTranscribe.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: '指定された Transcription ジョブが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({ jobId: 'nonexistent-job' });
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('指定された Transcription ジョブが見つかりません。');
  });

  it('returns COMPLETED status when job is completed', async () => {
    mockedGetJobStatusFromTranscribe.mockResolvedValue({
      jobId: 'job-002',
      transcribeJobName: 'tr-uuid-002',
      mediaFileId: 'media-file-002',
      status: 'COMPLETED',
      languageCode: 'ja-JP',
      maxSpeakerLabels: 5,
      outputS3Key: 'transcriptions/job-002/output.json',
      sessionId: 'session-001',
      startedBy: 'user-001',
      createdAt: '2024-01-15T10:30:00.000Z',
      updatedAt: '2024-01-15T11:00:00.000Z',
    });

    const event = createEvent({ jobId: 'job-002' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.status).toBe('COMPLETED');
    expect(body.sessionId).toBe('session-001');
  });

  it('returns FAILED status with failureReason when job failed', async () => {
    mockedGetJobStatusFromTranscribe.mockResolvedValue({
      jobId: 'job-003',
      transcribeJobName: 'tr-uuid-003',
      mediaFileId: 'media-file-003',
      status: 'FAILED',
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      failureReason: 'Audio quality too low',
      startedBy: 'user-001',
      createdAt: '2024-01-15T10:30:00.000Z',
      updatedAt: '2024-01-15T10:35:00.000Z',
    });

    const event = createEvent({ jobId: 'job-003' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.status).toBe('FAILED');
    expect(body.failureReason).toBe('Audio quality too low');
  });

  it('returns 500 for unexpected errors', async () => {
    mockedGetJobStatusFromTranscribe.mockRejectedValue(new Error('DynamoDB connection failed'));

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
