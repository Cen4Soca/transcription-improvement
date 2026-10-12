import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-sessions.js';

vi.mock('../services/access-control-service.js', () => ({
  getAccessibleSessionIds: vi.fn(),
}));

vi.mock('../repositories/session-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repositories/session-repository.js')>();
  return {
    ...actual,
    SESSION_PAGE_SIZE: 50,
    getAllSessions: vi.fn(),
    getSessionsByIds: vi.fn(),
    getAllSessionsPaginated: vi.fn(),
    countAllSessions: vi.fn(),
    filterByStatus: vi.fn((sessions, status) =>
      sessions.filter((s: { status: string }) => s.status === status)
    ),
    sortByCreatedAtDesc: vi.fn((sessions) =>
      [...sessions].sort(
        (a: { createdAt: string }, b: { createdAt: string }) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    ),
  };
});

import { getAccessibleSessionIds } from '../services/access-control-service.js';
import {
  getAllSessions,
  getSessionsByIds,
} from '../repositories/session-repository.js';

const mockedGetAccessibleSessionIds = vi.mocked(getAccessibleSessionIds);
const mockedGetAllSessions = vi.mocked(getAllSessions);
const mockedGetSessionsByIds = vi.mocked(getSessionsByIds);

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    status: string | undefined;
    page: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'user-001',
    email = 'test@example.com',
    role = 'REVIEWER',
    displayName = 'Test User',
    status,
    page,
  } = overrides;

  const queryStringParameters: Record<string, string> = {};
  if (status) queryStringParameters['status'] = status;
  if (page) queryStringParameters['page'] = page;

  const rawQueryString = Object.entries(queryStringParameters)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  return {
    version: '2.0',
    routeKey: 'GET /sessions',
    rawPath: '/sessions',
    rawQueryString,
    headers: {},
    queryStringParameters: Object.keys(queryStringParameters).length > 0 ? queryStringParameters : undefined,
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
        method: 'GET',
        path: '/sessions',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /sessions',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    pathParameters: undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleSessions = [
  {
    sessionId: 'session-1',
    name: 'Meeting Transcription',
    status: 'PENDING' as const,
    assignedReviewerCount: 3,
    consensusThreshold: 67,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    sessionId: 'session-2',
    name: 'Interview Recording',
    status: 'IN_PROGRESS' as const,
    assignedReviewerCount: 2,
    consensusThreshold: 75,
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T12:00:00.000Z',
  },
  {
    sessionId: 'session-3',
    name: 'Lecture Notes',
    status: 'COMPLETED' as const,
    assignedReviewerCount: 5,
    consensusThreshold: 80,
    createdAt: '2024-01-03T00:00:00.000Z',
    updatedAt: '2024-01-03T18:00:00.000Z',
  },
];

describe('GET /sessions handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ADMIN user', () => {
    it('returns all sessions for ADMIN user with PaginatedResponse format', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toHaveLength(3);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.currentPage).toBe(1);
      expect(body.pagination.pageSize).toBe(50);
      expect(body.pagination.totalItems).toBe(3);
      expect(body.pagination.totalPages).toBe(1);
      expect(body.pagination.hasNextPage).toBe(false);
      expect(body.pagination.hasPreviousPage).toBe(false);
      expect(mockedGetAllSessions).toHaveBeenCalled();
      expect(mockedGetSessionsByIds).not.toHaveBeenCalled();
    });

    it('returns sessions sorted by createdAt descending', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items[0].sessionId).toBe('session-3');
      expect(body.items[1].sessionId).toBe('session-2');
      expect(body.items[2].sessionId).toBe('session-1');
    });
  });

  describe('Non-ADMIN user (REVIEWER / TEAM_LEADER)', () => {
    it('returns only accessible sessions for REVIEWER', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue([
        'session-1',
        'session-2',
      ]);
      mockedGetSessionsByIds.mockResolvedValue([
        sampleSessions[0],
        sampleSessions[1],
      ]);

      const event = createEvent({ role: 'REVIEWER' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toHaveLength(2);
      expect(body.pagination.totalItems).toBe(2);
      expect(mockedGetSessionsByIds).toHaveBeenCalledWith([
        'session-1',
        'session-2',
      ]);
      expect(mockedGetAllSessions).not.toHaveBeenCalled();
    });

    it('returns empty items array when user has no accessible sessions', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue([]);

      const event = createEvent({ role: 'REVIEWER' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toEqual([]);
      expect(body.pagination.totalItems).toBe(0);
      expect(body.pagination.totalPages).toBe(0);
      expect(body.pagination.hasNextPage).toBe(false);
      expect(body.pagination.hasPreviousPage).toBe(false);
      expect(mockedGetSessionsByIds).not.toHaveBeenCalled();
      expect(mockedGetAllSessions).not.toHaveBeenCalled();
    });
  });

  describe('Status filtering', () => {
    it('filters sessions by PENDING status', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN', status: 'PENDING' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status).toBe('PENDING');
      expect(body.pagination.totalItems).toBe(1);
    });

    it('filters sessions by IN_PROGRESS status', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN', status: 'IN_PROGRESS' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status).toBe('IN_PROGRESS');
    });

    it('filters sessions by COMPLETED status', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN', status: 'COMPLETED' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status).toBe('COMPLETED');
    });

    it('returns empty items array when no sessions match the status filter', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue([sampleSessions[0]]);

      const event = createEvent({ role: 'ADMIN', status: 'COMPLETED' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toEqual([]);
      expect(body.pagination.totalItems).toBe(0);
    });

    it('returns 400 for invalid status parameter', async () => {
      const event = createEvent({ role: 'ADMIN', status: 'INVALID' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('status パラメータが不正です');
    });

    it('returns all sessions when no status filter is provided', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toHaveLength(3);
    });
  });

  describe('Pagination', () => {
    it('returns page 1 by default', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.pagination.currentPage).toBe(1);
    });

    it('returns specified page number', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN', page: '1' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.pagination.currentPage).toBe(1);
    });

    it('returns 400 for invalid page parameter (non-numeric)', async () => {
      const event = createEvent({ role: 'ADMIN', page: 'abc' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('page パラメータは1以上の整数で指定してください');
    });

    it('returns 400 for invalid page parameter (zero)', async () => {
      const event = createEvent({ role: 'ADMIN', page: '0' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid page parameter (negative)', async () => {
      const event = createEvent({ role: 'ADMIN', page: '-1' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('paginates results with 50 items per page', async () => {
      // Create 60 sessions to test pagination
      const manySessions = Array.from({ length: 60 }, (_, i) => ({
        sessionId: `session-${i + 1}`,
        name: `Session ${i + 1}`,
        status: 'PENDING' as const,
        assignedReviewerCount: 3,
        consensusThreshold: 67,
        createdAt: new Date(2024, 0, 1, 0, 0, i).toISOString(),
        updatedAt: new Date(2024, 0, 1, 0, 0, i).toISOString(),
      }));

      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(manySessions);

      // Page 1
      const event1 = createEvent({ role: 'ADMIN', page: '1' });
      const result1 = await handler(event1);
      const body1 = JSON.parse(result1.body as string);

      expect(body1.items).toHaveLength(50);
      expect(body1.pagination.currentPage).toBe(1);
      expect(body1.pagination.pageSize).toBe(50);
      expect(body1.pagination.totalItems).toBe(60);
      expect(body1.pagination.totalPages).toBe(2);
      expect(body1.pagination.hasNextPage).toBe(true);
      expect(body1.pagination.hasPreviousPage).toBe(false);

      // Page 2
      const event2 = createEvent({ role: 'ADMIN', page: '2' });
      const result2 = await handler(event2);
      const body2 = JSON.parse(result2.body as string);

      expect(body2.items).toHaveLength(10);
      expect(body2.pagination.currentPage).toBe(2);
      expect(body2.pagination.totalItems).toBe(60);
      expect(body2.pagination.totalPages).toBe(2);
      expect(body2.pagination.hasNextPage).toBe(false);
      expect(body2.pagination.hasPreviousPage).toBe(true);
    });

    it('returns empty items for page beyond total pages', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue(sampleSessions);

      const event = createEvent({ role: 'ADMIN', page: '5' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toEqual([]);
      expect(body.pagination.currentPage).toBe(5);
      expect(body.pagination.totalItems).toBe(3);
      expect(body.pagination.totalPages).toBe(1);
      expect(body.pagination.hasNextPage).toBe(false);
      expect(body.pagination.hasPreviousPage).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('returns 403 when JWT sub claim is missing', async () => {
      const event = createEvent({ userId: '' });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 500 when getAccessibleSessionIds fails', async () => {
      mockedGetAccessibleSessionIds.mockRejectedValue(
        new Error('DynamoDB connection error')
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('セッション一覧の取得に失敗しました。');
    });

    it('returns 500 when getAllSessions fails', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockRejectedValue(new Error('Scan timeout'));

      const event = createEvent({ role: 'ADMIN' });
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('セッション一覧の取得に失敗しました。');
      expect(body.error.details).toBe('Scan timeout');
    });

    it('returns 500 when getSessionsByIds fails', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(['session-1']);
      mockedGetSessionsByIds.mockRejectedValue(
        new Error('BatchGet failed')
      );

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body as string);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.details).toBe('BatchGet failed');
    });
  });

  describe('Response format', () => {
    it('returns correct PaginatedResponse shape', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue([sampleSessions[0]]);

      const event = createEvent({ role: 'ADMIN' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items[0]).toEqual({
        sessionId: 'session-1',
        name: 'Meeting Transcription',
        status: 'PENDING',
        assignedReviewerCount: 3,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      expect(body.pagination).toEqual({
        currentPage: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('returns empty items array when ADMIN has no sessions', async () => {
      mockedGetAccessibleSessionIds.mockResolvedValue(null);
      mockedGetAllSessions.mockResolvedValue([]);

      const event = createEvent({ role: 'ADMIN' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body as string);
      expect(body.items).toEqual([]);
      expect(body.pagination.totalItems).toBe(0);
      expect(body.pagination.totalPages).toBe(1);
    });
  });
});
