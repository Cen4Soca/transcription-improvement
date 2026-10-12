import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './download-transcription.js';

vi.mock('../services/download-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/download-service.js')>();
  return {
    ...actual,
    generateJson: vi.fn(),
    generateSrt: vi.fn(),
    generateDownloadFilename: vi.fn(),
  };
});

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
}));

import { generateJson, generateSrt, generateDownloadFilename } from '../services/download-service.js';
import { getSessionById } from '../repositories/session-repository.js';

const mockedGenerateJson = vi.mocked(generateJson);
const mockedGenerateSrt = vi.mocked(generateSrt);
const mockedGenerateDownloadFilename = vi.mocked(generateDownloadFilename);
const mockedGetSessionById = vi.mocked(getSessionById);

function createEvent(
  overrides: Partial<{
    sessionId: string | undefined;
    format: string | undefined;
    userId: string;
    role: string;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const sessionId = 'sessionId' in overrides ? overrides.sessionId : 'session-001';
  const format = 'format' in overrides ? overrides.format : undefined;
  const {
    userId = 'user-001',
    role = 'REVIEWER',
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /sessions/{sessionId}/download',
    rawPath: `/sessions/${sessionId ?? ''}/download`,
    rawQueryString: format ? `format=${format}` : '',
    headers: { 'content-type': 'application/json' },
    pathParameters: sessionId ? { sessionId } : undefined,
    queryStringParameters: format ? { format } : undefined,
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
        path: `/sessions/${sessionId ?? ''}/download`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /sessions/{sessionId}/download',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /sessions/{sessionId}/download handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedGenerateJson.mockResolvedValue({
      sessionName: '会議録_20240101',
      exportedAt: '2024-01-15T10:30:00.000Z',
      segments: [
        { startTime: 0, endTime: 3.5, text: 'テスト', speakerLabel: 'spk_0' },
      ],
    });

    mockedGenerateSrt.mockResolvedValue(
      '1\n00:00:00,000 --> 00:00:03,500\n[spk_0] テスト'
    );

    mockedGenerateDownloadFilename.mockReturnValue('会議録_20240101_20240115.json');

    mockedGetSessionById.mockResolvedValue({
      sessionId: 'session-001',
      name: '会議録_20240101',
      status: 'COMPLETED',
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-15T10:30:00.000Z',
    });
  });

  it('returns JSON format with Content-Disposition header by default', async () => {
    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const headers = result.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Content-Disposition']).toContain('attachment');
  });

  it('returns JSON format when format=json', async () => {
    const event = createEvent({ format: 'json' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const headers = result.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(mockedGenerateJson).toHaveBeenCalledWith('session-001', 'user-001');
  });

  it('returns SRT format when format=srt', async () => {
    mockedGenerateDownloadFilename.mockReturnValue('会議録_20240101_20240115.srt');

    const event = createEvent({ format: 'srt' });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const headers = result.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(headers['Content-Disposition']).toContain('attachment');
    expect(result.body).toContain('00:00:00,000 --> 00:00:03,500');
  });

  it('returns 400 for invalid format', async () => {
    const event = createEvent({ format: 'xml' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('xml');
  });

  it('returns 400 when sessionId is missing', async () => {
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

  it('returns error when no confirmed segments exist', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGenerateJson.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: '確定済みの Segment がありません。',
        statusCode: 400,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('確定済みの Segment');
  });

  it('returns 404 when session not found', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedGenerateJson.mockRejectedValue(
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
});
