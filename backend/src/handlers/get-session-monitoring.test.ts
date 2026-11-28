import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiEvent } from '../test-utils/api-event.js';

vi.mock('../utils/auth-middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/auth-middleware.js')>();
  return {
    ...actual,
    extractUser: vi.fn(async () => ({
      userId: 'lead', email: 'l@x', displayName: 'Lead', role: 'TEAM_LEADER',
    })),
  };
});
vi.mock('../services/monitoring-service.js', () => ({
  listSessionMonitoring: vi.fn(),
}));

import { handler } from './get-session-monitoring.js';
import { listSessionMonitoring } from '../services/monitoring-service.js';
import { forbiddenError } from '../utils/error-handler.js';

const mockedList = vi.mocked(listSessionMonitoring);
const emptyPage = {
  items: [],
  pagination: {
    currentPage: 1, pageSize: 50, totalItems: 0, totalPages: 1,
    hasNextPage: false, hasPreviousPage: false,
  },
};

describe('GET /sessions/monitoring handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue(emptyPage);
  });

  it('returns the monitoring page wrapped in data', async () => {
    const result = await handler(createApiEvent({ path: '/sessions/monitoring' }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).data.pagination.totalItems).toBe(0);
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ userId: 'lead' }), {}, 1);
  });

  it('parses every filter and the page parameter', async () => {
    await handler(
      createApiEvent({
        queryStringParameters: {
          status: 'IN_PROGRESS', teamId: 't1', userId: 'u1',
          unassignedOnly: 'false', stalledOnly: 'true', page: '2',
        },
      })
    );
    expect(mockedList).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'IN_PROGRESS', teamId: 't1', userId: 'u1', unassignedOnly: false, stalledOnly: true },
      2
    );
  });

  it.each([
    ['status', 'DONE', 'MONITORING_FILTER_INVALID'],
    ['stalledOnly', 'yes', 'MONITORING_FILTER_INVALID'],
    ['unassignedOnly', '1', 'MONITORING_FILTER_INVALID'],
    ['page', '0', 'PAGE_NUMBER_INVALID'],
    ['page', 'x', 'PAGE_NUMBER_INVALID'],
  ])('returns 400 for invalid %s=%s', async (key, value, errorCode) => {
    const result = await handler(createApiEvent({ queryStringParameters: { [key]: value } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.errorCode).toBe(errorCode);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('propagates AppError from the service (403)', async () => {
    mockedList.mockRejectedValue(forbiddenError('no'));
    const result = await handler(createApiEvent());
    expect(result.statusCode).toBe(403);
  });

  it('wraps unexpected failures as 500 with a detailed errorCode', async () => {
    mockedList.mockRejectedValue(new Error('ddb down'));
    const result = await handler(createApiEvent());
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body as string).error.errorCode).toBe('MONITORING_SESSIONS_FETCH_FAILED');
  });
});
