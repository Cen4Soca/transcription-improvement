import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './post-consensus-resolve.js';


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

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn().mockImplementation((params) => params),
  PutCommand: vi.fn().mockImplementation((params) => params),
  UpdateCommand: vi.fn().mockImplementation((params) => params),
}));

const mockSend = vi.fn();
vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
}));

import { getSessionById } from '../repositories/session-repository.js';
import type { SessionRecord } from '../repositories/session-repository.js';

const mockGetSessionById = vi.mocked(getSessionById);

function makeSession(status: SessionRecord['status']): SessionRecord {
  return {
    sessionId: 'session-123',
    name: 'Sample',
    status,
    assignedReviewerCount: 0,
    consensusThreshold: 67,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function createEvent(
  overrides: Partial<{
    userId: string;
    role: string;
    sessionId: string;
    body: string | null;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'admin-001',
    role = 'ADMIN',
    sessionId = 'session-123',
  } = overrides;

  const body = 'body' in overrides ? overrides.body : JSON.stringify({ segmentId: 'seg-1', selectedText: 'Resolved text' });

  return {
    version: '2.0',
    routeKey: 'POST /consensus/{sessionId}/resolve',
    rawPath: `/consensus/${sessionId}/resolve`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    pathParameters: sessionId ? { sessionId } : undefined,
    body,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'admin@example.com',
            'custom:role': role,
            'custom:displayName': 'Admin User',
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'POST',
        path: `/consensus/${sessionId}/resolve`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'POST /consensus/{sessionId}/resolve',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('POST /consensus/{sessionId}/resolve handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: an editable (IN_PROGRESS) session exists.
    mockGetSessionById.mockResolvedValue(makeSession('IN_PROGRESS'));
  });

  describe('Authorization', () => {
    it('returns 403 for REVIEWER users', async () => {
      const event = createEvent({ role: 'REVIEWER' });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 for TEAM_LEADER users', async () => {
      const event = createEvent({ role: 'TEAM_LEADER' });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Request validation', () => {
    it('returns 400 when body is missing', async () => {
      const event = createEvent({ body: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('リクエストボディが必要です');
    });

    it('returns 400 when body is invalid JSON', async () => {
      const event = createEvent({ body: 'not json' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('JSON形式が不正');
    });

    it('returns 400 when segmentId is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ selectedText: 'text' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('segmentId');
    });

    it('returns 400 when selectedText is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ segmentId: 'seg-1' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('selectedText');
    });
  });

  describe('Conflict resolution', () => {
    it('successfully resolves a CONFLICT segment', async () => {
      // Query for segment - returns CONFLICT segment
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#session-123',
            SK: 'SEGMENT#00001.000#seg-1',
            segmentId: 'seg-1',
            consensusStatus: 'CONFLICT',
          },
        ],
      });
      // PutCommand for ConsensusResult
      mockSend.mockResolvedValueOnce({});
      // UpdateCommand for segment status
      mockSend.mockResolvedValueOnce({});

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.sessionId).toBe('session-123');
      expect(body.data.segmentId).toBe('seg-1');
      expect(body.data.consensusText).toBe('Resolved text');
      expect(body.data.confirmedBy).toBe('admin-001');
      expect(body.data.confirmedAt).toBeDefined();
    });

    it('returns 400 VALIDATION_ERROR when the session is COMPLETED', async () => {
      mockGetSessionById.mockResolvedValue(makeSession('COMPLETED'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe(
        'このセッションは既に完了しているため編集できません。'
      );
      // The segment query must not run once the session is rejected.
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns 404 when segment does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when segment is CONFIRMED (auto-confirmed)', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#session-123',
            SK: 'SEGMENT#00001.000#seg-1',
            segmentId: 'seg-1',
            consensusStatus: 'CONFIRMED',
          },
        ],
      });

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('競合解決待ち');
    });

    it('returns 400 when segment is UNDECIDED', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#session-123',
            SK: 'SEGMENT#00001.000#seg-1',
            segmentId: 'seg-1',
            consensusStatus: 'UNDECIDED',
          },
        ],
      });

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('競合解決待ち');
    });

    it('allows empty string as selectedText', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#session-123',
            SK: 'SEGMENT#00001.000#seg-1',
            segmentId: 'seg-1',
            consensusStatus: 'CONFLICT',
          },
        ],
      });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      const event = createEvent({
        body: JSON.stringify({ segmentId: 'seg-1', selectedText: '' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.data.consensusText).toBe('');
    });

    it('returns 500 when DynamoDB save fails', async () => {
      // Query for segment succeeds
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#session-123',
            SK: 'SEGMENT#00001.000#seg-1',
            segmentId: 'seg-1',
            consensusStatus: 'CONFLICT',
          },
        ],
      });
      // PutCommand fails
      mockSend.mockRejectedValueOnce(new Error('ConditionalCheckFailed'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('競合解決の保存に失敗しました。');
    });
  });
});
