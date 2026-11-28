import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiEvent } from '../test-utils/api-event.js';

vi.mock('../utils/auth-middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/auth-middleware.js')>();
  return {
    ...actual,
    extractUser: vi.fn(async () => ({
      userId: 'admin', email: 'a@x', displayName: 'Admin', role: 'ADMIN',
    })),
  };
});
vi.mock('../services/monitoring-service.js', () => ({
  getSessionProgress: vi.fn(),
}));

import { handler } from './get-session-progress.js';
import { getSessionProgress } from '../services/monitoring-service.js';
import { notFoundError } from '../utils/error-handler.js';

const mockedProgress = vi.mocked(getSessionProgress);

describe('GET /sessions/{sessionId}/progress handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the progress for the session', async () => {
    mockedProgress.mockResolvedValue({
      sessionId: 's1', name: 'S', status: 'IN_PROGRESS', totalSegments: 4,
      isStalled: false, lastActivityAt: null, reviewers: [],
    });
    const result = await handler(createApiEvent({ pathParameters: { sessionId: 's1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).data.totalSegments).toBe(4);
    expect(mockedProgress).toHaveBeenCalledWith(expect.anything(), 's1');
  });

  it('returns 400 when sessionId is missing', async () => {
    const result = await handler(createApiEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.errorCode).toBe('SESSION_ID_REQUIRED');
  });

  it('propagates 404 from the service', async () => {
    mockedProgress.mockRejectedValue(notFoundError('Resource not found'));
    const result = await handler(createApiEvent({ pathParameters: { sessionId: 'x' } }));
    expect(result.statusCode).toBe(404);
  });

  it('wraps unexpected failures as 500 with a detailed errorCode', async () => {
    mockedProgress.mockRejectedValue(new Error('boom'));
    const result = await handler(createApiEvent({ pathParameters: { sessionId: 's1' } }));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body as string).error.errorCode).toBe('SESSION_PROGRESS_FETCH_FAILED');
  });
});
