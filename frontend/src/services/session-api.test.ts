import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionApi } from './session-api';
import { ApiClient } from './api-client';

describe('SessionApi', () => {
  let sessionApi: SessionApi;
  let mockClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    };
    sessionApi = new SessionApi(mockClient as unknown as ApiClient);
  });

  describe('markSessionComplete', () => {
    it('calls PATCH /sessions/{sessionId}/status with COMPLETED', async () => {
      const mockResponse = {
        ok: true,
        value: {
          data: {
            sessionId: 'session-123',
            status: 'COMPLETED',
            name: 'Test Session',
          },
        },
      };
      mockClient.patch.mockResolvedValue(mockResponse);

      const result = await sessionApi.markSessionComplete('session-123');

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/sessions/session-123/status',
        { status: 'COMPLETED' }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.status).toBe('COMPLETED');
      }
    });

    it('returns error when API call fails', async () => {
      const mockError = {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid status transition',
          statusCode: 400,
        },
      };
      mockClient.patch.mockResolvedValue(mockError);

      const result = await sessionApi.markSessionComplete('session-456');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('listAssignedSessions', () => {
    it('calls GET /sessions/assigned', async () => {
      mockClient.get.mockResolvedValue({
        ok: true,
        value: { data: { items: [] } },
      });

      const result = await sessionApi.listAssignedSessions();

      expect(mockClient.get).toHaveBeenCalledWith('/sessions/assigned');
      expect(result.ok).toBe(true);
    });
  });

  describe('assignSession', () => {
    it('calls PATCH /sessions/{id}/assignment with the target', async () => {
      mockClient.patch.mockResolvedValue({
        ok: true,
        value: { data: { sessionId: 'session-1' } },
      });

      const result = await sessionApi.assignSession('session-1', {
        assignedUserId: 'user-9',
      });

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/sessions/session-1/assignment',
        { assignedUserId: 'user-9' }
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('claimSession', () => {
    it('calls POST /sessions/{id}/join', async () => {
      mockClient.post.mockResolvedValue({
        ok: true,
        value: { data: { sessionId: 'session-1', assignedUserId: 'me' } },
      });

      const result = await sessionApi.claimSession('session-1');

      expect(mockClient.post).toHaveBeenCalledWith('/sessions/session-1/join', {});
      expect(result.ok).toBe(true);
    });

    it('returns error when the session is already claimed', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'already claimed', statusCode: 400 },
      });

      const result = await sessionApi.claimSession('session-1');

      expect(result.ok).toBe(false);
    });
  });

  describe('listJoinableSessions', () => {
    it('calls GET /sessions/joinable', async () => {
      mockClient.get.mockResolvedValue({
        ok: true,
        value: { data: { items: [] } },
      });

      const result = await sessionApi.listJoinableSessions();

      expect(mockClient.get).toHaveBeenCalledWith('/sessions/joinable');
      expect(result.ok).toBe(true);
    });
  });

  describe('forceAggregateSession', () => {
    it('calls POST /sessions/{id}/aggregate with an empty body', async () => {
      mockClient.post.mockResolvedValue({
        ok: true,
        value: {
          data: {
            sessionId: 'session-1',
            status: 'COMPLETED',
            totalReviewers: 2,
            confirmedCount: 1,
            conflictCount: 1,
          },
        },
      });

      const result = await sessionApi.forceAggregateSession('session-1');

      expect(mockClient.post).toHaveBeenCalledWith(
        '/sessions/session-1/aggregate',
        {}
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.status).toBe('COMPLETED');
      }
    });

    it('returns error when the session is already completed', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'このセッションは既に完了しています。',
          statusCode: 400,
        },
      });

      const result = await sessionApi.forceAggregateSession('session-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns error when aggregation is forbidden', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: '自チームのセッションのみ集計できます。',
          statusCode: 403,
        },
      });

      const result = await sessionApi.forceAggregateSession('session-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('reopenSession', () => {
    it('calls POST /sessions/{id}/reopen with an empty body', async () => {
      mockClient.post.mockResolvedValue({
        ok: true,
        value: {
          data: {
            sessionId: 'session-1',
            status: 'IN_PROGRESS',
          },
        },
      });

      const result = await sessionApi.reopenSession('session-1');

      expect(mockClient.post).toHaveBeenCalledWith(
        '/sessions/session-1/reopen',
        {}
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.status).toBe('IN_PROGRESS');
      }
    });

    it('returns error when reopen is forbidden', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: '自チームのセッションのみ操作できます。',
          statusCode: 403,
        },
      });

      const result = await sessionApi.reopenSession('session-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('selfAssignSession', () => {
    it('calls POST /sessions/{id}/self-assign', async () => {
      mockClient.post.mockResolvedValue({
        ok: true,
        value: { data: { sessionId: 'session-1' } },
      });

      const result = await sessionApi.selfAssignSession('session-1');

      expect(mockClient.post).toHaveBeenCalledWith(
        '/sessions/session-1/self-assign',
        {}
      );
      expect(result.ok).toBe(true);
    });

    it('returns error when self-assign is forbidden', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'not your team', statusCode: 403 },
      });

      const result = await sessionApi.selfAssignSession('session-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });
  });
});
