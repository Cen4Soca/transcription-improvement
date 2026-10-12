import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './post-speaker-label.js';

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/session-service.js', () => ({
  addSpeakerLabel: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { checkSessionAccess } from '../services/access-control-service.js';
import { addSpeakerLabel } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedAddSpeakerLabel = vi.mocked(addSpeakerLabel);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

function createEvent(
  overrides: Partial<{
    role: string;
    sessionId: string | null;
    body: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const sessionId =
    overrides.sessionId === undefined ? 'session-001' : overrides.sessionId;
  const body =
    overrides.body === undefined ? JSON.stringify({ label: 'spk_1' }) : overrides.body;

  return {
    version: '2.0',
    routeKey: 'POST /sessions/{sessionId}/speaker-labels',
    rawPath: `/sessions/${sessionId}/speaker-labels`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    body: body ?? undefined,
    pathParameters: sessionId ? { sessionId } : undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: 'user-001',
            email: 'test@example.com',
            'custom:role': overrides.role ?? 'REVIEWER',
            'custom:displayName': 'Test User',
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'POST',
        path: `/sessions/${sessionId}/speaker-labels`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'POST /sessions/{sessionId}/speaker-labels',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleUpdatedSession = {
  sessionId: 'session-001',
  name: 'Session',
  status: 'IN_PROGRESS' as const,
  assignedReviewerCount: 3,
  consensusThreshold: 67,
  speakerLabels: ['spk_0', 'spk_1'],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('POST /sessions/{sessionId}/speaker-labels handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds the label and records an audit log', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    mockedAddSpeakerLabel.mockResolvedValue(sampleUpdatedSession);
    mockedRecordAuditLog.mockResolvedValue(undefined);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.speakerLabels).toEqual(['spk_0', 'spk_1']);
    expect(mockedAddSpeakerLabel).toHaveBeenCalledWith('session-001', 'spk_1');
    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'SPEAKER_LABEL_CHANGED',
        resourceId: 'session-001',
        resourceType: 'ReviewSession',
        metadata: { action: 'ADD', label: 'spk_1' },
      })
    );
  });

  it('returns 400 when sessionId path parameter is missing', async () => {
    const result = await handler(createEvent({ sessionId: null }));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body is empty', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    const result = await handler(createEvent({ body: null }));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('label');
  });

  it('returns 400 when label is not a string', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    const result = await handler(createEvent({ body: JSON.stringify({ label: 123 }) }));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when the service rejects a duplicate label', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    const { AppError } = await import('../utils/error-handler.js');
    mockedAddSpeakerLabel.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Speaker label already exists.',
        statusCode: 400,
      })
    );

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });

  it('returns 404 when the user cannot access the session', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedCheckSessionAccess.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 when the service throws a raw error', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    mockedAddSpeakerLabel.mockRejectedValue(new Error('DynamoDB write failed'));

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('話者ラベルの追加に失敗しました。');
  });
});
