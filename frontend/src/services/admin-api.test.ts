import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminApi, mapAssignment } from './admin-api';
import { ApiClient } from './api-client';

/**
 * Unit tests for AdminApi team-assignment surface (bugfix:
 * missing-frontend-consensus-and-team-assignment).
 *
 * Verifies getTeamAssignments / assignSession / unassignSession call the
 * correct path / method / body on the (mocked) ApiClient and that the backend
 * createdBy/createdAt fields are mapped to frontend assignedBy/assignedAt.
 *
 * Validates: Requirements 2.5, 2.6, 2.7, 2.8
 */
describe('AdminApi — team assignments', () => {
  let adminApi: AdminApi;
  let mockClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    adminApi = new AdminApi(mockClient as unknown as ApiClient);
  });

  describe('mapAssignment', () => {
    it('maps createdBy/createdAt to assignedBy/assignedAt', () => {
      const mapped = mapAssignment({
        teamId: 'team-1',
        sessionId: 'session-1',
        createdBy: 'admin-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      expect(mapped).toEqual({
        teamId: 'team-1',
        sessionId: 'session-1',
        assignedBy: 'admin-1',
        assignedAt: '2024-01-01T00:00:00.000Z',
      });
    });
  });

  describe('getTeamAssignments', () => {
    it('calls GET /admin/teams/{teamId}/assignments and maps raw records', async () => {
      mockClient.get.mockResolvedValue({
        ok: true,
        value: {
          data: [
            {
              teamId: 'team-1',
              sessionId: 'session-1',
              createdBy: 'admin-1',
              createdAt: '2024-01-01T00:00:00.000Z',
            },
            {
              teamId: 'team-1',
              sessionId: 'session-2',
              createdBy: 'leader-1',
              createdAt: '2024-01-02T00:00:00.000Z',
            },
          ],
        },
      });

      const result = await adminApi.getTeamAssignments('team-1');

      expect(mockClient.get).toHaveBeenCalledWith('/admin/teams/team-1/assignments');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data).toEqual([
          {
            teamId: 'team-1',
            sessionId: 'session-1',
            assignedBy: 'admin-1',
            assignedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            teamId: 'team-1',
            sessionId: 'session-2',
            assignedBy: 'leader-1',
            assignedAt: '2024-01-02T00:00:00.000Z',
          },
        ]);
      }
    });

    it('returns the error unchanged on failure (no mapping)', async () => {
      mockClient.get.mockResolvedValue({
        ok: false,
        error: { code: 'FORBIDDEN', message: '自チーム以外は操作できません。', statusCode: 403 },
      });

      const result = await adminApi.getTeamAssignments('team-9');

      expect(mockClient.get).toHaveBeenCalledWith('/admin/teams/team-9/assignments');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('assignSession', () => {
    it('calls POST /admin/teams/{teamId}/assignments with { sessionId } and maps the record', async () => {
      mockClient.post.mockResolvedValue({
        ok: true,
        value: {
          data: {
            teamId: 'team-1',
            sessionId: 'session-1',
            createdBy: 'admin-1',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        },
      });

      const result = await adminApi.assignSession('team-1', 'session-1');

      expect(mockClient.post).toHaveBeenCalledWith('/admin/teams/team-1/assignments', {
        sessionId: 'session-1',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data).toEqual({
          teamId: 'team-1',
          sessionId: 'session-1',
          assignedBy: 'admin-1',
          assignedAt: '2024-01-01T00:00:00.000Z',
        });
      }
    });

    it('returns the error unchanged when assignment is forbidden', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: { code: 'FORBIDDEN', message: '自チーム以外は操作できません。', statusCode: 403 },
      });

      const result = await adminApi.assignSession('team-9', 'session-1');

      expect(mockClient.post).toHaveBeenCalledWith('/admin/teams/team-9/assignments', {
        sessionId: 'session-1',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('unassignSession', () => {
    it('calls DELETE /admin/teams/{teamId}/assignments/{sessionId}', async () => {
      mockClient.delete.mockResolvedValue({
        ok: true,
        value: { data: { deleted: true } },
      });

      const result = await adminApi.unassignSession('team-1', 'session-1');

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/admin/teams/team-1/assignments/session-1'
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.deleted).toBe(true);
      }
    });

    it('returns the error unchanged when unassignment fails', async () => {
      mockClient.delete.mockResolvedValue({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'assignment not found', statusCode: 404 },
      });

      const result = await adminApi.unassignSession('team-1', 'session-404');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });
});
