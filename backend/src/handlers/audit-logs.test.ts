import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { listAuditLogsHandler, deleteAuditLogsHandler } from './audit-logs.js';


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

vi.mock('../services/audit-service.js', () => ({
  searchAuditLogs: vi.fn(),
  removeAuditLogs: vi.fn(),
}));

import { searchAuditLogs, removeAuditLogs } from '../services/audit-service.js';

const mockedSearchAuditLogs = vi.mocked(searchAuditLogs);
const mockedRemoveAuditLogs = vi.mocked(removeAuditLogs);

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    method: string;
    path: string;
    queryStringParameters: Record<string, string> | undefined;
    body: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'admin-001',
    email = 'admin@example.com',
    role = 'ADMIN',
    displayName = 'Admin User',
    method = 'GET',
    path = '/admin/audit-logs',
    queryStringParameters,
    body,
  } = overrides;

  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    queryStringParameters,
    pathParameters: undefined,
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
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleAuditLogs = [
  {
    logId: 'log-001',
    createdAt: '2024-01-15T10:00:00.000Z',
    actorUserId: 'admin-001',
    actorRole: 'ADMIN' as const,
    operationType: 'USER_MANAGEMENT' as const,
    resourceId: 'user-123',
    resourceType: 'User',
  },
  {
    logId: 'log-002',
    createdAt: '2024-01-14T09:00:00.000Z',
    actorUserId: 'admin-001',
    actorRole: 'ADMIN' as const,
    operationType: 'IP_ALLOWLIST_CHANGE' as const,
    resourceId: 'entry-456',
    resourceType: 'IPAllowlistEntry',
  },
];

describe('GET /admin/audit-logs - listAuditLogsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns audit logs with pagination for ADMIN', async () => {
    mockedSearchAuditLogs.mockResolvedValue({
      items: sampleAuditLogs,
      totalCount: 2,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    const event = createEvent();
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(100);
    expect(body.pagination.totalCount).toBe(2);
    expect(body.pagination.totalPages).toBe(1);
  });

  it('passes query parameters to service', async () => {
    mockedSearchAuditLogs.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    const event = createEvent({
      queryStringParameters: {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
        actorUserId: 'user-001',
        operationType: 'USER_MANAGEMENT',
        page: '2',
      },
    });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockedSearchAuditLogs).toHaveBeenCalledWith({
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-01-31T23:59:59.999Z',
      actorUserId: 'user-001',
      operationType: 'USER_MANAGEMENT',
      page: 2,
    });
  });

  it('returns 403 for REVIEWER', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 for TEAM_LEADER', async () => {
    const event = createEvent({ role: 'TEAM_LEADER' });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 for invalid operationType', async () => {
    const event = createEvent({
      queryStringParameters: { operationType: 'INVALID_TYPE' },
    });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('無効な操作種別');
  });

  it('returns 400 for invalid page number', async () => {
    const event = createEvent({
      queryStringParameters: { page: '0' },
    });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ページ番号は1以上');
  });

  it('returns 400 for non-numeric page', async () => {
    const event = createEvent({
      queryStringParameters: { page: 'abc' },
    });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ページ番号は1以上');
  });

  it('returns 400 for invalid startDate format', async () => {
    const event = createEvent({
      queryStringParameters: { startDate: 'not-a-date' },
    });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('開始日はISO 8601形式');
  });

  it('returns 400 for invalid endDate format', async () => {
    const event = createEvent({
      queryStringParameters: { endDate: 'not-a-date' },
    });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('終了日はISO 8601形式');
  });

  it('defaults to page 1 when page is not provided', async () => {
    mockedSearchAuditLogs.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    const event = createEvent();
    await listAuditLogsHandler(event);

    expect(mockedSearchAuditLogs).toHaveBeenCalledWith({
      startDate: undefined,
      endDate: undefined,
      actorUserId: undefined,
      operationType: undefined,
      page: 1,
    });
  });

  it('returns correct pagination for multi-page results', async () => {
    mockedSearchAuditLogs.mockResolvedValue({
      items: sampleAuditLogs,
      totalCount: 250,
      page: 2,
      pageSize: 100,
      totalPages: 3,
    });

    const event = createEvent({
      queryStringParameters: { page: '2' },
    });
    const result = await listAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.totalCount).toBe(250);
    expect(body.pagination.totalPages).toBe(3);
    expect(body.pagination.pageSize).toBe(100);
  });

  it('filters by all valid operation types', async () => {
    const validTypes = [
      'IP_ALLOWLIST_CHANGE',
      'USER_MANAGEMENT',
      'TEAM_MANAGEMENT',
      'REVIEW_ASSIGNMENT_CHANGE',
      'TEAM_ASSIGNMENT_CHANGE',
      'SESSION_COMPLETED',
      'SESSION_NAME_CHANGED',
      'SESSION_MANUAL_AGGREGATED',
      'SESSION_REOPENED',
      'CONSENSUS_MANUAL_CONFIRM',
      'CORRECTION_CONFIRMED',
      'SPEAKER_LABEL_CHANGED',
      'LOGIN_FAILURE',
      'MEDIA_DELETED',
      'TRANSCRIPTION_DELETED',
      'PARTIAL_DELETION_FAILURE',
      'LANGUAGE_MODEL_CREATED',
      'LANGUAGE_MODEL_DELETED',
      'LANGUAGE_MODEL_TEAM_CHANGED',
      'LANGUAGE_MODEL_NAME_CHANGED',
      'TRANSCRIPTION_JOB_STARTED',
      'AUDIT_LOG_DELETED',
    ];

    for (const opType of validTypes) {
      mockedSearchAuditLogs.mockResolvedValue({
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const event = createEvent({
        queryStringParameters: { operationType: opType },
      });
      const result = await listAuditLogsHandler(event);

      expect(result.statusCode).toBe(200);
      expect(mockedSearchAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ operationType: opType })
      );
    }
  });

  it('accepts the new language-model operation types as query param', async () => {
    const newTypes = [
      'LANGUAGE_MODEL_DELETED',
      'LANGUAGE_MODEL_TEAM_CHANGED',
      'LANGUAGE_MODEL_NAME_CHANGED',
    ];

    for (const opType of newTypes) {
      mockedSearchAuditLogs.mockResolvedValue({
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const event = createEvent({
        queryStringParameters: { operationType: opType },
      });
      const result = await listAuditLogsHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.error).toBeUndefined();
      expect(mockedSearchAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ operationType: opType })
      );
    }
  });
});

describe('DELETE /admin/audit-logs - deleteAuditLogsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes audit logs matching filter criteria', async () => {
    mockedRemoveAuditLogs.mockResolvedValue(5);

    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
      }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deletedCount).toBe(5);
    expect(mockedRemoveAuditLogs).toHaveBeenCalledWith(
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
        actorUserId: undefined,
        operationType: undefined,
      },
      { userId: 'admin-001', role: 'ADMIN' }
    );
  });

  it('deletes by actorUserId filter', async () => {
    mockedRemoveAuditLogs.mockResolvedValue(3);

    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({ actorUserId: 'user-001' }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deletedCount).toBe(3);
  });

  it('deletes by operationType filter', async () => {
    mockedRemoveAuditLogs.mockResolvedValue(10);

    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({ operationType: 'IP_ALLOWLIST_CHANGE' }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deletedCount).toBe(10);
  });

  it('returns 403 for REVIEWER', async () => {
    const event = createEvent({
      role: 'REVIEWER',
      method: 'DELETE',
      body: JSON.stringify({ actorUserId: 'user-001' }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(403);
  });

  it('returns 403 for TEAM_LEADER', async () => {
    const event = createEvent({
      role: 'TEAM_LEADER',
      method: 'DELETE',
      body: JSON.stringify({ actorUserId: 'user-001' }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when no filter is provided', async () => {
    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('削除条件を少なくとも1つ指定');
  });

  it('returns 400 when body is empty', async () => {
    const event = createEvent({
      method: 'DELETE',
      body: undefined,
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('削除条件を少なくとも1つ指定');
  });

  it('returns 400 for invalid operationType', async () => {
    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({ operationType: 'INVALID' }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('無効な操作種別');
  });

  it('accepts the new language-model operation types in the body', async () => {
    const newTypes = [
      'LANGUAGE_MODEL_DELETED',
      'LANGUAGE_MODEL_TEAM_CHANGED',
      'LANGUAGE_MODEL_NAME_CHANGED',
    ];

    for (const opType of newTypes) {
      mockedRemoveAuditLogs.mockResolvedValue(1);

      const event = createEvent({
        method: 'DELETE',
        body: JSON.stringify({ operationType: opType }),
      });
      const result = await deleteAuditLogsHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.error).toBeUndefined();
      expect(mockedRemoveAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ operationType: opType }),
        expect.anything()
      );
    }
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = createEvent({
      method: 'DELETE',
      body: 'not-json',
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('JSON形式が不正');
  });

  it('returns 400 for invalid startDate format', async () => {
    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({ startDate: 'not-a-date' }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('開始日はISO 8601形式');
  });

  it('deletes with combined filters (date range + actorUserId + operationType)', async () => {
    mockedRemoveAuditLogs.mockResolvedValue(1);

    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
        actorUserId: 'admin-001',
        operationType: 'USER_MANAGEMENT',
      }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deletedCount).toBe(1);
    expect(mockedRemoveAuditLogs).toHaveBeenCalledWith(
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
        actorUserId: 'admin-001',
        operationType: 'USER_MANAGEMENT',
      },
      { userId: 'admin-001', role: 'ADMIN' }
    );
  });

  it('returns deletedCount of 0 when no matching logs found', async () => {
    mockedRemoveAuditLogs.mockResolvedValue(0);

    const event = createEvent({
      method: 'DELETE',
      body: JSON.stringify({
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2020-01-02T00:00:00.000Z',
      }),
    });
    const result = await deleteAuditLogsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deletedCount).toBe(0);
  });
});
