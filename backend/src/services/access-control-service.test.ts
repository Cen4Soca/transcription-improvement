import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthUser } from '../utils/auth-middleware.js';
import { AppError } from '../utils/error-handler.js';

// Mock the DynamoDB client
vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  TABLE_NAME: 'TestTable',
}));

// Mock the language model repository (used by checkLanguageModelAccess)
vi.mock('../repositories/language-model-repository.js', () => ({
  getModel: vi.fn(),
}));

import { docClient } from '../utils/dynamodb-client.js';
import { getModel } from '../repositories/language-model-repository.js';
import type { LanguageModelMetadata } from '../types/index.js';
import {
  checkSessionAccess,
  isTeamMember,
  hasTeamAssignment,
  hasReviewAssignment,
  getUserTeamIds,
  isSessionAssignedToUserTeams,
  requireTeamAccess,
  getAccessibleSessionIds,
  canAccessMediaFile,
  usersShareTeam,
  checkLanguageModelAccess,
} from './access-control-service.js';

const mockSend = vi.mocked(docClient.send);
const mockedGetModel = vi.mocked(getModel);

function buildModelMetadata(
  overrides: Partial<LanguageModelMetadata> = {}
): LanguageModelMetadata {
  return {
    modelName: 'model-1',
    teamId: 'team-A',
    displayName: 'Model 1',
    displayNameLower: 'model 1',
    baseModelName: 'WideBand',
    createdBy: 'leader-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    sessionIds: [],
    s3Key: 'training-data/model-1/training.txt',
    deletionStatus: 'ACTIVE',
    ...overrides,
  };
}

function createUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    role: 'REVIEWER',
    ...overrides,
  };
}

describe('access-control-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkSessionAccess', () => {
    it('should allow ADMIN access without DB queries', async () => {
      const admin = createUser({ role: 'ADMIN' });

      await expect(checkSessionAccess(admin, 'session-1')).resolves.toBeUndefined();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should allow access when user has direct ReviewAssignment', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      // First query: ReviewAssignment check (returns match)
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'USER#user-123', SK: 'ASSIGNMENT#session-1' }],
      } as any);

      await expect(checkSessionAccess(reviewer, 'session-1')).resolves.toBeUndefined();
    });

    it('should allow access when session is assigned to user team', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      // First query: ReviewAssignment check (no match)
      mockSend.mockResolvedValueOnce({ Items: [] } as any);
      // Second query: getUserTeamIds (user belongs to team-A)
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-A' }],
      } as any);
      // Third query: isSessionAssignedToUserTeams (session assigned to team-A)
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'SESSION#session-1', GSI1SK: 'TEAM#team-A' }],
      } as any);

      await expect(checkSessionAccess(reviewer, 'session-1')).resolves.toBeUndefined();
    });

    it('should throw 404 when user has no access', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      // ReviewAssignment check (no match)
      mockSend.mockResolvedValueOnce({ Items: [] } as any);
      // getUserTeamIds (user belongs to team-A)
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-A' }],
      } as any);
      // isSessionAssignedToUserTeams (session assigned to team-B, not team-A)
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'SESSION#session-1', GSI1SK: 'TEAM#team-B' }],
      } as any);

      try {
        await checkSessionAccess(reviewer, 'session-1');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).statusCode).toBe(404);
      }
    });

    it('should throw 404 when user has no teams and no direct assignment', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      // ReviewAssignment check (no match)
      mockSend.mockResolvedValueOnce({ Items: [] } as any);
      // getUserTeamIds (no teams)
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      await expect(checkSessionAccess(reviewer, 'session-1')).rejects.toThrow(AppError);
    });
  });

  describe('isTeamMember', () => {
    it('should return true when user is a team member', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'TEAM#team-1', SK: 'MEMBER#user-123' }],
      } as any);

      const result = await isTeamMember('user-123', 'team-1');
      expect(result).toBe(true);
    });

    it('should return false when user is not a team member', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      const result = await isTeamMember('user-123', 'team-1');
      expect(result).toBe(false);
    });
  });

  describe('hasTeamAssignment', () => {
    it('should return true when team has session assignment', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'TEAM#team-1', SK: 'ASSIGNMENT#session-1' }],
      } as any);

      const result = await hasTeamAssignment('team-1', 'session-1');
      expect(result).toBe(true);
    });

    it('should return false when team does not have session assignment', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      const result = await hasTeamAssignment('team-1', 'session-1');
      expect(result).toBe(false);
    });
  });

  describe('hasReviewAssignment', () => {
    it('should return true when user has direct assignment', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'USER#user-123', SK: 'ASSIGNMENT#session-1' }],
      } as any);

      const result = await hasReviewAssignment('user-123', 'session-1');
      expect(result).toBe(true);
    });

    it('should return false when user has no direct assignment', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      const result = await hasReviewAssignment('user-123', 'session-1');
      expect(result).toBe(false);
    });
  });

  describe('getUserTeamIds', () => {
    it('should return team IDs for a user', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-A' },
          { GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-B' },
        ],
      } as any);

      const result = await getUserTeamIds('user-123');
      expect(result).toEqual(['team-A', 'team-B']);
    });

    it('should return empty array when user has no teams', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      const result = await getUserTeamIds('user-123');
      expect(result).toEqual([]);
    });
  });

  describe('isSessionAssignedToUserTeams', () => {
    it('should return true when session is assigned to one of user teams', async () => {
      // getUserTeamIds
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-A' }],
      } as any);
      // Query session assignments
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'SESSION#session-1', GSI1SK: 'TEAM#team-A' }],
      } as any);

      const result = await isSessionAssignedToUserTeams('user-123', 'session-1');
      expect(result).toBe(true);
    });

    it('should return false when session is not assigned to any user team', async () => {
      // getUserTeamIds
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-A' }],
      } as any);
      // Query session assignments (different team)
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'SESSION#session-1', GSI1SK: 'TEAM#team-B' }],
      } as any);

      const result = await isSessionAssignedToUserTeams('user-123', 'session-1');
      expect(result).toBe(false);
    });

    it('should return false when user has no teams', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      const result = await isSessionAssignedToUserTeams('user-123', 'session-1');
      expect(result).toBe(false);
    });
  });

  describe('requireTeamAccess', () => {
    it('should allow ADMIN access to any team', async () => {
      const admin = createUser({ role: 'ADMIN' });

      await expect(requireTeamAccess(admin, 'team-1')).resolves.toBeUndefined();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should allow TEAM_LEADER access to their own team', async () => {
      const leader = createUser({ role: 'TEAM_LEADER' });

      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'TEAM#team-1', SK: 'MEMBER#user-123' }],
      } as any);

      await expect(requireTeamAccess(leader, 'team-1')).resolves.toBeUndefined();
    });

    it('should throw 404 when TEAM_LEADER accesses another team', async () => {
      const leader = createUser({ role: 'TEAM_LEADER' });

      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      await expect(requireTeamAccess(leader, 'other-team')).rejects.toThrow(AppError);
      try {
        // Reset mock for second call
        mockSend.mockResolvedValueOnce({ Items: [] } as any);
        await requireTeamAccess(leader, 'other-team');
      } catch (e) {
        expect((e as AppError).statusCode).toBe(404);
      }
    });

    it('should throw 403 when REVIEWER tries team operations', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      await expect(requireTeamAccess(reviewer, 'team-1')).rejects.toThrow(AppError);
      try {
        await requireTeamAccess(reviewer, 'team-1');
      } catch (e) {
        expect((e as AppError).statusCode).toBe(403);
      }
    });
  });

  describe('getAccessibleSessionIds', () => {
    it('should return null for ADMIN (no filter needed)', async () => {
      const admin = createUser({ role: 'ADMIN' });

      const result = await getAccessibleSessionIds(admin);
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should return session IDs from team assignments and direct assignments', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      // getUserTeamIds
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-A' }],
      } as any);
      // Team assignments for team-A
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'TEAM#team-A', SK: 'ASSIGNMENT#session-1' },
          { PK: 'TEAM#team-A', SK: 'ASSIGNMENT#session-2' },
        ],
      } as any);
      // Direct ReviewAssignments
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'USER#user-123', SK: 'ASSIGNMENT#session-3' }],
      } as any);

      const result = await getAccessibleSessionIds(reviewer);
      expect(result).toContain('session-1');
      expect(result).toContain('session-2');
      expect(result).toContain('session-3');
      expect(result).toHaveLength(3);
    });

    it('should deduplicate session IDs', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      // getUserTeamIds
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1PK: 'USER#user-123', GSI1SK: 'TEAM#team-A' }],
      } as any);
      // Team assignments (session-1)
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'TEAM#team-A', SK: 'ASSIGNMENT#session-1' }],
      } as any);
      // Direct ReviewAssignments (also session-1)
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'USER#user-123', SK: 'ASSIGNMENT#session-1' }],
      } as any);

      const result = await getAccessibleSessionIds(reviewer);
      expect(result).toEqual(['session-1']);
    });

    it('should return empty array when user has no access', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });

      // getUserTeamIds (no teams)
      mockSend.mockResolvedValueOnce({ Items: [] } as any);
      // Direct ReviewAssignments (none)
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      const result = await getAccessibleSessionIds(reviewer);
      expect(result).toEqual([]);
    });
  });

  describe('canAccessMediaFile', () => {
    it('allows ADMIN to access any media file without DB queries', async () => {
      const admin = createUser({ role: 'ADMIN', userId: 'admin-1' });
      const result = await canAccessMediaFile(admin, 'someone-else');
      expect(result).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('allows a REVIEWER to access their own upload without DB queries', async () => {
      const reviewer = createUser({ role: 'REVIEWER', userId: 'user-1' });
      const result = await canAccessMediaFile(reviewer, 'user-1');
      expect(result).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("denies a REVIEWER access to another user's upload", async () => {
      const reviewer = createUser({ role: 'REVIEWER', userId: 'user-1' });
      const result = await canAccessMediaFile(reviewer, 'user-2');
      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('allows a TEAM_LEADER to access an upload by a team member (shared team)', async () => {
      const leader = createUser({ role: 'TEAM_LEADER', userId: 'leader-1' });
      mockSend.mockResolvedValueOnce({ Items: [{ GSI1SK: 'TEAM#t1' }] } as any);
      mockSend.mockResolvedValueOnce({ Items: [{ GSI1SK: 'TEAM#t1' }] } as any);

      const result = await canAccessMediaFile(leader, 'member-1');
      expect(result).toBe(true);
    });

    it('denies a TEAM_LEADER access to an upload by a non-member (no shared team)', async () => {
      const leader = createUser({ role: 'TEAM_LEADER', userId: 'leader-1' });
      mockSend.mockResolvedValueOnce({ Items: [{ GSI1SK: 'TEAM#t1' }] } as any);
      mockSend.mockResolvedValueOnce({ Items: [{ GSI1SK: 'TEAM#t2' }] } as any);

      const result = await canAccessMediaFile(leader, 'outsider-1');
      expect(result).toBe(false);
    });
  });

  describe('usersShareTeam', () => {
    it('returns true immediately when the two ids are identical', async () => {
      const result = await usersShareTeam('user-1', 'user-1');
      expect(result).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns false when one user has no teams', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ GSI1SK: 'TEAM#t1' }] } as any);
      mockSend.mockResolvedValueOnce({ Items: [] } as any);

      const result = await usersShareTeam('user-a', 'user-b');
      expect(result).toBe(false);
    });
  });

  describe('checkLanguageModelAccess', () => {
    it('allows ADMIN to access any model without a team lookup', async () => {
      const admin = createUser({ role: 'ADMIN' });
      mockedGetModel.mockResolvedValue(buildModelMetadata({ teamId: 'team-A' }));

      const result = await checkLanguageModelAccess(admin, 'model-1');
      expect(result.modelName).toBe('model-1');
      // No GSI query (getUserTeamIds) should be needed for ADMIN.
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('allows a non-ADMIN member of the owning team', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });
      mockedGetModel.mockResolvedValue(buildModelMetadata({ teamId: 'team-A' }));
      // getUserTeamIds -> ['team-A']
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1SK: 'TEAM#team-A' }],
      } as any);

      const result = await checkLanguageModelAccess(reviewer, 'model-1');
      expect(result.teamId).toBe('team-A');
    });

    it('throws 404 for a non-ADMIN when the model belongs to another team', async () => {
      const reviewer = createUser({ role: 'REVIEWER' });
      mockedGetModel.mockResolvedValue(buildModelMetadata({ teamId: 'team-A' }));
      // getUserTeamIds -> ['team-B']
      mockSend.mockResolvedValueOnce({
        Items: [{ GSI1SK: 'TEAM#team-B' }],
      } as any);

      await expect(
        checkLanguageModelAccess(reviewer, 'model-1')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 404 when the model metadata does not exist', async () => {
      const admin = createUser({ role: 'ADMIN' });
      mockedGetModel.mockResolvedValue(null);

      await expect(
        checkLanguageModelAccess(admin, 'missing-model')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 404 when the model is soft-deleted (PENDING)', async () => {
      const admin = createUser({ role: 'ADMIN' });
      mockedGetModel.mockResolvedValue(
        buildModelMetadata({ deletionStatus: 'PENDING' })
      );

      await expect(
        checkLanguageModelAccess(admin, 'model-1')
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
