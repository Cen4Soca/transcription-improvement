import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './post-corrections.js';

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/correction-service.js', () => ({
  validateCorrectionInput: vi.fn(),
  createCorrection: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

const mockEventBridgeSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: vi.fn((input) => ({ input })),
}));

import { checkSessionAccess } from '../services/access-control-service.js';
import { validateCorrectionInput, createCorrection } from '../services/correction-service.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedValidateCorrectionInput = vi.mocked(validateCorrectionInput);
const mockedCreateCorrection = vi.mocked(createCorrection);

function createEvent(
  overrides: Partial<{
    sessionId: string | undefined;
    userId: string;
    email: string;
    role: string;
    displayName: string;
    body: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    sessionId = 'session-123',
    userId = 'user-001',
    email = 'test@example.com',
    role = 'REVIEWER',
    displayName = 'Test User',
    body = JSON.stringify({
      correctionId: 'corr-001',
      segmentId: 'seg-001',
      correctionType: 'TEXT',
      beforeText: 'original',
      afterText: 'corrected',
    }),
  } = overrides;

  return {
    version: '2.0',
    routeKey: 'POST /sessions/{sessionId}/corrections',
    rawPath: `/sessions/${sessionId}/corrections`,
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
        path: `/sessions/${sessionId}/corrections`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'POST /sessions/{sessionId}/corrections',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    pathParameters: sessionId !== undefined ? { sessionId } : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('POST /sessions/{sessionId}/corrections handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventBridgeSend.mockResolvedValue({});
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    mockedValidateCorrectionInput.mockReturnValue({
      correctionId: 'corr-001',
      segmentId: 'seg-001',
      correctionType: 'TEXT',
      beforeText: 'original',
      afterText: 'corrected',
    });
  });

  it('returns 201 when a new correction is created successfully', async () => {
    const correctionRecord = {
      correctionId: 'corr-001',
      sessionId: 'session-123',
      segmentId: 'seg-001',
      userId: 'user-001',
      correctionType: 'TEXT' as const,
      beforeText: 'original',
      afterText: 'corrected',
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    mockedCreateCorrection.mockResolvedValue({
      correction: correctionRecord,
      isDuplicate: false,
    });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.correctionId).toBe('corr-001');
    expect(body.sessionId).toBe('session-123');
    expect(body.userId).toBe('user-001');
    expect(body.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns 200 when correction is a duplicate (idempotent)', async () => {
    const correctionRecord = {
      correctionId: 'corr-001',
      sessionId: 'session-123',
      segmentId: 'seg-001',
      userId: 'user-001',
      correctionType: 'TEXT' as const,
      beforeText: 'original',
      afterText: 'corrected',
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    mockedCreateCorrection.mockResolvedValue({
      correction: correctionRecord,
      isDuplicate: true,
    });

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.correctionId).toBe('corr-001');
  });

  it('returns 400 when sessionId path parameter is missing', async () => {
    const event = createEvent({ sessionId: undefined });
    event.pathParameters = undefined;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('sessionId パスパラメータが必要です。');
  });

  it('returns 403 when JWT sub claim is missing', async () => {
    const event = createEvent({ userId: '' });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when user does not have session access', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedCheckSessionAccess.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 when request body validation fails', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedValidateCorrectionInput.mockImplementation(() => {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'correctionId は必須です。',
        statusCode: 400,
      });
    });

    const event = createEvent({ body: JSON.stringify({}) });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('correctionId は必須です。');
  });

  it('returns 500 when correction save fails', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedCreateCorrection.mockRejectedValue(
      new AppError({
        code: 'INTERNAL_ERROR',
        message: '修正内容の保存に失敗しました。',
        statusCode: 500,
        details: 'DynamoDB timeout',
      })
    );

    const event = createEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('修正内容の保存に失敗しました。');
  });

  it('calls checkSessionAccess with correct user and sessionId', async () => {
    mockedCreateCorrection.mockResolvedValue({
      correction: {
        correctionId: 'corr-001',
        sessionId: 'session-abc',
        segmentId: 'seg-001',
        userId: 'user-xyz',
        correctionType: 'TEXT',
        beforeText: 'original',
        afterText: 'corrected',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      isDuplicate: false,
    });

    const event = createEvent({ userId: 'user-xyz', sessionId: 'session-abc' });
    await handler(event);

    expect(mockedCheckSessionAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-xyz' }),
      'session-abc'
    );
  });

  it('calls createCorrection with correct sessionId, user, and input', async () => {
    const validatedInput = {
      correctionId: 'corr-001',
      segmentId: 'seg-001',
      correctionType: 'TEXT' as const,
      beforeText: 'original',
      afterText: 'corrected',
    };
    mockedValidateCorrectionInput.mockReturnValue(validatedInput);
    mockedCreateCorrection.mockResolvedValue({
      correction: {
        ...validatedInput,
        sessionId: 'session-123',
        userId: 'user-001',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      isDuplicate: false,
    });

    const event = createEvent({ userId: 'user-001', sessionId: 'session-123' });
    await handler(event);

    expect(mockedCreateCorrection).toHaveBeenCalledWith(
      'session-123',
      expect.objectContaining({ userId: 'user-001' }),
      validatedInput
    );
  });

  it('does not call createCorrection when session access is denied', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedCheckSessionAccess.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent();
    await handler(event);

    expect(mockedCreateCorrection).not.toHaveBeenCalled();
  });

  it('handles null body gracefully', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedValidateCorrectionInput.mockImplementation(() => {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です。',
        statusCode: 400,
      });
    });

    const event = createEvent({ body: null });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('CorrectionConfirmed event wiring (consensus-aggregation trigger)', () => {
    it('publishes a CorrectionConfirmed event when a new correction is created', async () => {
      mockedCreateCorrection.mockResolvedValue({
        correction: {
          correctionId: 'corr-001',
          sessionId: 'session-123',
          segmentId: 'seg-001',
          userId: 'user-001',
          correctionType: 'TEXT',
          beforeText: 'original',
          afterText: 'corrected',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        isDuplicate: false,
      });

      const event = createEvent();
      await handler(event);

      expect(mockEventBridgeSend).toHaveBeenCalledOnce();
      const command = mockEventBridgeSend.mock.calls[0][0];
      const entry = command.input.Entries[0];
      expect(entry.Source).toBe('transcription-review-app');
      expect(entry.DetailType).toBe('CorrectionConfirmed');
      expect(JSON.parse(entry.Detail)).toEqual({
        sessionId: 'session-123',
        segmentId: 'seg-001',
        userId: 'user-001',
        correctionId: 'corr-001',
      });
    });

    it('does not publish a CorrectionConfirmed event for a duplicate correction', async () => {
      mockedCreateCorrection.mockResolvedValue({
        correction: {
          correctionId: 'corr-001',
          sessionId: 'session-123',
          segmentId: 'seg-001',
          userId: 'user-001',
          correctionType: 'TEXT',
          beforeText: 'original',
          afterText: 'corrected',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        isDuplicate: true,
      });

      const event = createEvent();
      await handler(event);

      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });
  });

  describe('DynamoDB access pattern layer separation (Req 10.10)', () => {
    it('creates correction scoped to the authenticated user only', async () => {
      const validatedInput = {
        correctionId: 'corr-001',
        segmentId: 'seg-001',
        correctionType: 'TEXT' as const,
        beforeText: 'original',
        afterText: 'corrected',
      };
      mockedValidateCorrectionInput.mockReturnValue(validatedInput);
      mockedCreateCorrection.mockResolvedValue({
        correction: {
          ...validatedInput,
          sessionId: 'session-123',
          userId: 'user-A',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        isDuplicate: false,
      });

      const event = createEvent({ userId: 'user-A', sessionId: 'session-123' });
      await handler(event);

      // Verify createCorrection is called with the authenticated user
      expect(mockedCreateCorrection).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({ userId: 'user-A' }),
        validatedInput
      );
    });

    it('uses JWT-authenticated userId regardless of body content', async () => {
      // Even if someone tries to inject a different userId in the body,
      // the handler uses the JWT-authenticated user
      const validatedInput = {
        correctionId: 'corr-001',
        segmentId: 'seg-001',
        correctionType: 'TEXT' as const,
        beforeText: 'original',
        afterText: 'corrected',
      };
      mockedValidateCorrectionInput.mockReturnValue(validatedInput);
      mockedCreateCorrection.mockResolvedValue({
        correction: {
          ...validatedInput,
          sessionId: 'session-123',
          userId: 'user-B',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        isDuplicate: false,
      });

      const event = createEvent({
        userId: 'user-B',
        sessionId: 'session-123',
        body: JSON.stringify({
          correctionId: 'corr-001',
          segmentId: 'seg-001',
          correctionType: 'TEXT',
          beforeText: 'original',
          afterText: 'corrected',
          userId: 'user-HACKER', // Attempted injection
        }),
      });
      await handler(event);

      // The handler must use the JWT user, not the body userId
      expect(mockedCreateCorrection).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({ userId: 'user-B' }),
        validatedInput
      );
    });
  });

  describe('Session status auto-update (Req 3.2)', () => {
    it('session status update is handled by createCorrection service', async () => {
      // The handler delegates to createCorrection which internally handles
      // the PENDING → IN_PROGRESS status update
      mockedCreateCorrection.mockResolvedValue({
        correction: {
          correctionId: 'corr-001',
          sessionId: 'session-123',
          segmentId: 'seg-001',
          userId: 'user-001',
          correctionType: 'TEXT',
          beforeText: 'original',
          afterText: 'corrected',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        isDuplicate: false,
      });

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      expect(mockedCreateCorrection).toHaveBeenCalledOnce();
    });
  });
});
