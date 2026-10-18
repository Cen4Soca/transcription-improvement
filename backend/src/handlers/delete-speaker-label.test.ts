import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './delete-speaker-label.js';

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/session-service.js', () => ({
  deleteSpeakerLabel: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import { checkSessionAccess } from '../services/access-control-service.js';
import { deleteSpeakerLabel } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedDeleteSpeakerLabel = vi.mocked(deleteSpeakerLabel);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

function createEvent(
  overrides: Partial<{
    sessionId: string | null;
    label: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const sessionId =
    overrides.sessionId === undefined ? 'session-001' : overrides.sessionId;
  const label = overrides.label === undefined ? 'spk_1' : overrides.label;

  const pathParameters: Record<string, string> = {};
  if (sessionId) pathParameters.sessionId = sessionId;
  if (label) pathParameters.label = label;

  return {
    version: '2.0',
    routeKey: 'DELETE /sessions/{sessionId}/speaker-labels/{label}',
    rawPath: `/sessions/${sessionId}/speaker-labels/${label}`,
    rawQueryString: '',
    headers: {},
    pathParameters:
      Object.keys(pathParameters).length > 0 ? pathParameters : undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: 'user-001',
            email: 'test@example.com',
            'custom:role': 'REVIEWER',
            'custom:displayName': 'Test User',
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'DELETE',
        path: `/sessions/${sessionId}/speaker-labels/${label}`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'DELETE /sessions/{sessionId}/speaker-labels/{label}',
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
  speakerLabels: ['spk_0'],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('DELETE /sessions/{sessionId}/speaker-labels/{label} handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the label and records an audit log', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    mockedDeleteSpeakerLabel.mockResolvedValue(sampleUpdatedSession);
    mockedRecordAuditLog.mockResolvedValue(undefined);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.speakerLabels).toEqual(['spk_0']);
    expect(mockedDeleteSpeakerLabel).toHaveBeenCalledWith('session-001', 'spk_1');
    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'SPEAKER_LABEL_CHANGED',
        resourceId: 'session-001',
        resourceType: 'ReviewSession',
        metadata: { action: 'DELETE', label: 'spk_1' },
      })
    );
  });

  it('URL-decodes the label path parameter before deleting', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    mockedDeleteSpeakerLabel.mockResolvedValue(sampleUpdatedSession);
    mockedRecordAuditLog.mockResolvedValue(undefined);

    // '話者 A' URL-encoded
    const encoded = encodeURIComponent('話者 A');
    await handler(createEvent({ label: encoded }));

    expect(mockedDeleteSpeakerLabel).toHaveBeenCalledWith('session-001', '話者 A');
  });

  it('returns 400 when sessionId path parameter is missing', async () => {
    const result = await handler(createEvent({ sessionId: null }));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when label path parameter is missing', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    const result = await handler(createEvent({ label: null }));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('label');
  });

  it('returns 400 when the service rejects a label in use', async () => {
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    const { AppError } = await import('../utils/error-handler.js');
    mockedDeleteSpeakerLabel.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Speaker label is in use and cannot be deleted.',
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
    mockedDeleteSpeakerLabel.mockRejectedValue(new Error('DynamoDB write failed'));

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('話者ラベルの削除に失敗しました。');
  });
});
