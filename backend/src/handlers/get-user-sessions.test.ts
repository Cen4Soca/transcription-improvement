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
  listUserSessions: vi.fn(),
}));

import { handler } from './get-user-sessions.js';
import { listUserSessions } from '../services/monitoring-service.js';
import { notFoundError } from '../utils/error-handler.js';

const mockedSessions = vi.mocked(listUserSessions);

describe('GET /monitoring/users/{userId}/sessions handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the user sessions wrapped in data', async () => {
    mockedSessions.mockResolvedValue([]);
    const result = await handler(createApiEvent({ pathParameters: { userId: 'u1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).data.items).toEqual([]);
    expect(mockedSessions).toHaveBeenCalledWith(expect.anything(), 'u1');
  });

  it('returns 400 when userId is missing', async () => {
    const result = await handler(createApiEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.errorCode).toBe('USER_ID_REQUIRED');
  });

  it('propagates 404 for users outside the leader scope', async () => {
    mockedSessions.mockRejectedValue(notFoundError('Resource not found'));
    const result = await handler(createApiEvent({ pathParameters: { userId: 'x' } }));
    expect(result.statusCode).toBe(404);
  });

  it('wraps unexpected failures as 500 with a detailed errorCode', async () => {
    mockedSessions.mockRejectedValue(new Error('boom'));
    const result = await handler(createApiEvent({ pathParameters: { userId: 'u1' } }));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body as string).error.errorCode).toBe('USER_SESSIONS_FETCH_FAILED');
  });
});
