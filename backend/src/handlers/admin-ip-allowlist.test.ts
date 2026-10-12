import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  listIPAllowlistHandler,
  addIPAllowlistHandler,
  deleteIPAllowlistHandler,
} from './admin-ip-allowlist.js';

vi.mock('../services/ip-allowlist-service.js', () => ({
  getAllEntries: vi.fn(),
  addEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));

import {
  getAllEntries,
  addEntry,
  deleteEntry,
} from '../services/ip-allowlist-service.js';

const mockedGetAllEntries = vi.mocked(getAllEntries);
const mockedAddEntry = vi.mocked(addEntry);
const mockedDeleteEntry = vi.mocked(deleteEntry);

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    method: string;
    path: string;
    pathParameters: Record<string, string>;
    body: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'admin-001',
    email = 'admin@example.com',
    role = 'ADMIN',
    displayName = 'Admin User',
    method = 'GET',
    path = '/admin/ip-allowlist',
    pathParameters,
    body,
  } = overrides;

  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: undefined,
    pathParameters,
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

const sampleEntries = [
  {
    entryId: 'entry-001',
    cidr: '192.168.1.0/24',
    description: 'Office network',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-001',
  },
  {
    entryId: 'entry-002',
    cidr: '10.0.0.0/8',
    description: 'VPN',
    createdAt: '2024-01-02T00:00:00.000Z',
    createdBy: 'admin-001',
  },
];

describe('GET /admin/ip-allowlist - listIPAllowlistHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all IP allowlist entries for ADMIN', async () => {
    mockedGetAllEntries.mockResolvedValue(sampleEntries);

    const event = createEvent();
    const result = await listIPAllowlistHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].cidr).toBe('192.168.1.0/24');
    expect(body.data[1].cidr).toBe('10.0.0.0/8');
  });

  it('returns empty array when no entries exist (no IP restriction)', async () => {
    mockedGetAllEntries.mockResolvedValue([]);

    const event = createEvent();
    const result = await listIPAllowlistHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toEqual([]);
  });

  it('returns 403 for REVIEWER', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await listIPAllowlistHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 for TEAM_LEADER', async () => {
    const event = createEvent({ role: 'TEAM_LEADER' });
    const result = await listIPAllowlistHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /admin/ip-allowlist - addIPAllowlistHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a valid IPv4 CIDR entry', async () => {
    const newEntry = {
      entryId: 'entry-003',
      cidr: '203.0.113.0/24',
      description: 'Partner network',
      createdAt: '2024-01-10T00:00:00.000Z',
      createdBy: 'admin-001',
    };
    mockedAddEntry.mockResolvedValue(newEntry);

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ cidr: '203.0.113.0/24', description: 'Partner network' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.cidr).toBe('203.0.113.0/24');
    expect(body.data.description).toBe('Partner network');
    expect(mockedAddEntry).toHaveBeenCalledWith({
      cidr: '203.0.113.0/24',
      description: 'Partner network',
      createdBy: 'admin-001',
      actor: { userId: 'admin-001', email: 'admin@example.com', displayName: 'Admin User', role: 'ADMIN' },
    });
  });

  it('adds a CIDR entry without description', async () => {
    const newEntry = {
      entryId: 'entry-004',
      cidr: '10.0.0.0/8',
      description: undefined,
      createdAt: '2024-01-10T00:00:00.000Z',
      createdBy: 'admin-001',
    };
    mockedAddEntry.mockResolvedValue(newEntry);

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ cidr: '10.0.0.0/8' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.cidr).toBe('10.0.0.0/8');
    expect(mockedAddEntry).toHaveBeenCalledWith({
      cidr: '10.0.0.0/8',
      description: undefined,
      createdBy: 'admin-001',
      actor: expect.objectContaining({ userId: 'admin-001' }),
    });
  });

  it('returns 400 when cidr is missing', async () => {
    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ description: 'No CIDR' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('CIDRブロックは必須');
  });

  it('returns 400 when cidr is not a string', async () => {
    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ cidr: 12345 }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const event = createEvent({
      method: 'POST',
      body: 'not-json',
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('JSON形式が不正');
  });

  it('returns 400 when CIDR format is invalid (delegated to service)', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedAddEntry.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'CIDR形式が無効です。IPv4（例: 192.168.1.0/24）またはIPv6（例: 2001:db8::/32）の形式で入力してください。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ cidr: 'invalid-cidr' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('CIDR形式が無効');
  });

  it('returns 400 when max entries limit reached (delegated to service)', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedAddEntry.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'IPアドレス許可リストの最大件数（1000件）に達しています。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ cidr: '172.16.0.0/12' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('最大件数');
  });

  it('returns 500 when WAF update fails (fail-closed)', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedAddEntry.mockRejectedValue(
      new AppError({
        code: 'INTERNAL_ERROR',
        message: 'WAF IPセットの更新に失敗しました。',
        statusCode: 500,
      })
    );

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ cidr: '192.168.0.0/16' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('WAF');
  });

  it('returns 403 for REVIEWER', async () => {
    const event = createEvent({
      role: 'REVIEWER',
      method: 'POST',
      body: JSON.stringify({ cidr: '10.0.0.0/8' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(403);
  });

  it('returns 403 for TEAM_LEADER', async () => {
    const event = createEvent({
      role: 'TEAM_LEADER',
      method: 'POST',
      body: JSON.stringify({ cidr: '10.0.0.0/8' }),
    });
    const result = await addIPAllowlistHandler(event);

    expect(result.statusCode).toBe(403);
  });
});

describe('DELETE /admin/ip-allowlist/{entryId} - deleteIPAllowlistHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes an existing entry', async () => {
    mockedDeleteEntry.mockResolvedValue(undefined);

    const event = createEvent({
      method: 'DELETE',
      path: '/admin/ip-allowlist/entry-001',
      pathParameters: { entryId: 'entry-001' },
    });
    const result = await deleteIPAllowlistHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.message).toContain('削除しました');
    expect(mockedDeleteEntry).toHaveBeenCalledWith(
      'entry-001',
      { userId: 'admin-001', email: 'admin@example.com', displayName: 'Admin User', role: 'ADMIN' }
    );
  });

  it('returns 400 when entryId is missing from path', async () => {
    const event = createEvent({
      method: 'DELETE',
      path: '/admin/ip-allowlist/',
      pathParameters: undefined,
    });
    const result = await deleteIPAllowlistHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('エントリIDは必須');
  });

  it('returns 400 when entry does not exist (delegated to service)', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedDeleteEntry.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: '指定されたIPアドレスエントリが見つかりません。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      method: 'DELETE',
      path: '/admin/ip-allowlist/nonexistent',
      pathParameters: { entryId: 'nonexistent' },
    });
    const result = await deleteIPAllowlistHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('見つかりません');
  });

  it('returns 500 when WAF update fails on delete (fail-closed)', async () => {
    const { AppError } = await import('../utils/error-handler.js');
    mockedDeleteEntry.mockRejectedValue(
      new AppError({
        code: 'INTERNAL_ERROR',
        message: 'WAF IPセットの更新に失敗しました。',
        statusCode: 500,
      })
    );

    const event = createEvent({
      method: 'DELETE',
      path: '/admin/ip-allowlist/entry-001',
      pathParameters: { entryId: 'entry-001' },
    });
    const result = await deleteIPAllowlistHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('WAF');
  });

  it('returns 403 for REVIEWER', async () => {
    const event = createEvent({
      role: 'REVIEWER',
      method: 'DELETE',
      path: '/admin/ip-allowlist/entry-001',
      pathParameters: { entryId: 'entry-001' },
    });
    const result = await deleteIPAllowlistHandler(event);

    expect(result.statusCode).toBe(403);
  });

  it('returns 403 for TEAM_LEADER', async () => {
    const event = createEvent({
      role: 'TEAM_LEADER',
      method: 'DELETE',
      path: '/admin/ip-allowlist/entry-001',
      pathParameters: { entryId: 'entry-001' },
    });
    const result = await deleteIPAllowlistHandler(event);

    expect(result.statusCode).toBe(403);
  });
});
