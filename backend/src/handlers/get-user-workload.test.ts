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
  listUserWorkload: vi.fn(),
}));

import { handler } from './get-user-workload.js';
import { listUserWorkload } from '../services/monitoring-service.js';
import { forbiddenError } from '../utils/error-handler.js';

const mockedWorkload = vi.mocked(listUserWorkload);

describe('GET /monitoring/users handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the workload items wrapped in data', async () => {
    mockedWorkload.mockResolvedValue([
      {
        userId: 'u1', displayName: 'A', email: 'a@x', role: 'REVIEWER', isActive: true,
        assignedCount: 3, inProgressCount: 2, stalledCount: 1,
      },
    ]);
    const result = await handler(createApiEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).data.items[0].stalledCount).toBe(1);
  });

  it('propagates 403 for REVIEWER', async () => {
    mockedWorkload.mockRejectedValue(forbiddenError('no'));
    const result = await handler(createApiEvent());
    expect(result.statusCode).toBe(403);
  });

  it('wraps unexpected failures as 500 with a detailed errorCode', async () => {
    mockedWorkload.mockRejectedValue(new Error('boom'));
    const result = await handler(createApiEvent());
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body as string).error.errorCode).toBe('USER_WORKLOAD_FETCH_FAILED');
  });
});
