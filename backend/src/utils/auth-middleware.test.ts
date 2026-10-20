import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  extractUser,
  isValidRole,
  hasMinimumRole,
  requireRole,
  denyResourceAccess,
  isAdmin,
  isTeamLeaderOrAbove,
  checkUserActive,
} from './auth-middleware.js';
import { AppError } from './error-handler.js';

// Mock the user-repository
vi.mock('../repositories/user-repository.js', () => ({
  getUserByEmail: vi.fn(),
}));

// Mock the user-service (JIT provisioning is orchestrated here)
vi.mock('../services/user-service.js', () => ({
  provisionUserOnFirstLogin: vi.fn(),
}));

import { getUserByEmail } from '../repositories/user-repository.js';
import { provisionUserOnFirstLogin } from '../services/user-service.js';

const mockGetUserByEmail = vi.mocked(getUserByEmail);
const mockProvisionUser = vi.mocked(provisionUserOnFirstLogin);

function createMockEvent(
  claims: Record<string, string>
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims,
          scopes: [],
        },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('auth-middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractUser', () => {
    it('should use custom:role from JWT but resolve canonical userId from DynamoDB', async () => {
      // Regression (reviewer-media-playback-fix): the custom:role path must still
      // resolve the canonical DynamoDB userId (not the Cognito sub), so that
      // access-control lookups keyed on userId succeed for non-ADMIN users.
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'db-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'cognito-sub-xyz',
        email: 'test@example.com',
        'custom:displayName': 'Test User',
        'custom:role': 'REVIEWER',
      });

      const user = await extractUser(event);

      expect(user).toEqual({
        userId: 'db-user-123', // canonical DynamoDB userId, NOT the sub
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'REVIEWER', // role still taken from custom:role claim
      });
      expect(mockGetUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockProvisionUser).not.toHaveBeenCalled();
    });

    it('should prefer custom:role over the DynamoDB record role', async () => {
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'db-user-abc',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'REVIEWER', // record role differs from claim
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'cognito-sub-abc',
        email: 'test@example.com',
        'custom:role': 'ADMIN',
      });

      const user = await extractUser(event);

      expect(user.userId).toBe('db-user-abc');
      expect(user.role).toBe('ADMIN');
    });

    it('should extract ADMIN role from JWT claims', async () => {
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'db-admin-789',
        email: 'admin@example.com',
        displayName: 'Admin User',
        role: 'ADMIN',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'admin-789',
        email: 'admin@example.com',
        'custom:displayName': 'Admin User',
        'custom:role': 'ADMIN',
      });

      const user = await extractUser(event);
      expect(user.role).toBe('ADMIN');
      expect(user.userId).toBe('db-admin-789');
    });

    it('should fallback to DynamoDB when custom:role is missing', async () => {
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'db-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'ADMIN',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'cognito-sub-123',
        email: 'test@example.com',
      });

      const user = await extractUser(event);

      expect(user).toEqual({
        userId: 'db-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'ADMIN',
      });
      expect(mockGetUserByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should fallback to DynamoDB when custom:role is invalid', async () => {
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'db-user-456',
        email: 'test@example.com',
        displayName: 'Leader',
        role: 'TEAM_LEADER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'user-123',
        email: 'test@example.com',
        'custom:role': 'INVALID_ROLE',
      });

      const user = await extractUser(event);
      expect(user.role).toBe('TEAM_LEADER');
      expect(mockGetUserByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should throw 403 when sub claim is missing', async () => {
      const event = createMockEvent({
        email: 'test@example.com',
      });

      try {
        await extractUser(event);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).statusCode).toBe(403);
      }
    });

    it('should throw 403 when email is missing and role is not in JWT', async () => {
      const event = createMockEvent({
        sub: 'user-123',
      });

      try {
        await extractUser(event);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).statusCode).toBe(403);
        expect((e as AppError).details).toBe('Missing email claim in JWT');
      }
    });

    it('should JIT-provision a REVIEWER when no DynamoDB record exists (fallback path)', async () => {
      mockGetUserByEmail.mockResolvedValueOnce(null);
      mockProvisionUser.mockResolvedValueOnce({
        userId: 'jit-user-1',
        email: 'unknown@example.com',
        displayName: 'Unknown',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'user-123',
        email: 'unknown@example.com',
        'custom:displayName': 'Unknown',
      });

      const user = await extractUser(event);

      expect(mockProvisionUser).toHaveBeenCalledWith({
        email: 'unknown@example.com',
        displayName: 'Unknown',
      });
      expect(user).toEqual({
        userId: 'jit-user-1',
        email: 'unknown@example.com',
        displayName: 'Unknown',
        role: 'REVIEWER',
      });
    });

    it('should JIT-provision with empty displayName when custom:displayName claim is absent', async () => {
      mockGetUserByEmail.mockResolvedValueOnce(null);
      mockProvisionUser.mockResolvedValueOnce({
        userId: 'jit-user-2',
        email: 'local-part@example.com',
        displayName: 'local-part',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'user-123',
        email: 'local-part@example.com',
      });

      const user = await extractUser(event);

      // The claim is absent → service receives an empty displayName and derives
      // the local-part itself.
      expect(mockProvisionUser).toHaveBeenCalledWith({
        email: 'local-part@example.com',
        displayName: '',
      });
      expect(user.role).toBe('REVIEWER');
      expect(user.displayName).toBe('local-part');
    });

    it('should NOT JIT-provision when a DynamoDB record already exists (regression)', async () => {
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'existing-user',
        email: 'test@example.com',
        displayName: 'Existing',
        role: 'TEAM_LEADER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'user-123',
        email: 'test@example.com',
      });

      const user = await extractUser(event);

      expect(mockProvisionUser).not.toHaveBeenCalled();
      expect(user.role).toBe('TEAM_LEADER');
    });

    it('should NOT JIT-provision when custom:role is present and a record exists', async () => {
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'db-role-user',
        email: 'test@example.com',
        displayName: 'Role User',
        role: 'ADMIN',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'user-123',
        email: 'test@example.com',
        'custom:displayName': 'Role User',
        'custom:role': 'ADMIN',
      });

      const user = await extractUser(event);

      expect(mockGetUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockProvisionUser).not.toHaveBeenCalled();
      expect(user.userId).toBe('db-role-user');
      expect(user.role).toBe('ADMIN');
    });

    it('should JIT-provision on the custom:role path when no record exists', async () => {
      mockGetUserByEmail.mockResolvedValueOnce(null);
      mockProvisionUser.mockResolvedValueOnce({
        userId: 'jit-role-user',
        email: 'new@example.com',
        displayName: 'New',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'user-123',
        email: 'new@example.com',
        'custom:displayName': 'New',
        'custom:role': 'TEAM_LEADER',
      });

      const user = await extractUser(event);

      expect(mockProvisionUser).toHaveBeenCalledWith({ email: 'new@example.com', displayName: 'New' });
      expect(user.userId).toBe('jit-role-user');
      // custom:role claim still wins for role
      expect(user.role).toBe('TEAM_LEADER');
    });

    it('should throw 403 when user is deactivated (fallback path)', async () => {
      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'REVIEWER',
        isActive: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const event = createMockEvent({
        sub: 'user-123',
        email: 'test@example.com',
      });

      try {
        await extractUser(event);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).statusCode).toBe(403);
        expect((e as AppError).message).toBe('アカウントが無効化されています。');
      }
    });
  });

  describe('isValidRole', () => {
    it('should return true for valid roles', () => {
      expect(isValidRole('REVIEWER')).toBe(true);
      expect(isValidRole('TEAM_LEADER')).toBe(true);
      expect(isValidRole('ADMIN')).toBe(true);
    });

    it('should return false for invalid roles', () => {
      expect(isValidRole('INVALID')).toBe(false);
      expect(isValidRole('')).toBe(false);
      expect(isValidRole('admin')).toBe(false);
    });
  });

  describe('hasMinimumRole', () => {
    it('should return true when user role meets minimum', () => {
      expect(hasMinimumRole('ADMIN', 'REVIEWER')).toBe(true);
      expect(hasMinimumRole('ADMIN', 'TEAM_LEADER')).toBe(true);
      expect(hasMinimumRole('ADMIN', 'ADMIN')).toBe(true);
      expect(hasMinimumRole('TEAM_LEADER', 'REVIEWER')).toBe(true);
      expect(hasMinimumRole('TEAM_LEADER', 'TEAM_LEADER')).toBe(true);
      expect(hasMinimumRole('REVIEWER', 'REVIEWER')).toBe(true);
    });

    it('should return false when user role is below minimum', () => {
      expect(hasMinimumRole('REVIEWER', 'TEAM_LEADER')).toBe(false);
      expect(hasMinimumRole('REVIEWER', 'ADMIN')).toBe(false);
      expect(hasMinimumRole('TEAM_LEADER', 'ADMIN')).toBe(false);
    });
  });

  describe('requireRole', () => {
    it('should not throw when user has sufficient role', () => {
      const adminUser = { userId: '1', email: '', displayName: '', role: 'ADMIN' as const };
      expect(() => requireRole(adminUser, 'REVIEWER')).not.toThrow();
      expect(() => requireRole(adminUser, 'TEAM_LEADER')).not.toThrow();
      expect(() => requireRole(adminUser, 'ADMIN')).not.toThrow();
    });

    it('should throw 403 when user has insufficient role', () => {
      const reviewer = { userId: '1', email: '', displayName: '', role: 'REVIEWER' as const };

      expect(() => requireRole(reviewer, 'ADMIN')).toThrow(AppError);
      try {
        requireRole(reviewer, 'ADMIN');
      } catch (e) {
        expect((e as AppError).statusCode).toBe(403);
        expect((e as AppError).message).toBe('この操作を実行する権限がありません。');
      }
    });
  });

  describe('denyResourceAccess', () => {
    it('should throw 404 to hide resource existence', () => {
      expect(() => denyResourceAccess()).toThrow(AppError);
      try {
        denyResourceAccess();
      } catch (e) {
        expect((e as AppError).statusCode).toBe(404);
        expect((e as AppError).message).toBe('リソースが見つかりません。');
      }
    });
  });

  describe('isAdmin', () => {
    it('should return true for ADMIN role', () => {
      expect(isAdmin({ userId: '1', email: '', displayName: '', role: 'ADMIN' })).toBe(true);
    });

    it('should return false for non-ADMIN roles', () => {
      expect(isAdmin({ userId: '1', email: '', displayName: '', role: 'REVIEWER' })).toBe(false);
      expect(isAdmin({ userId: '1', email: '', displayName: '', role: 'TEAM_LEADER' })).toBe(false);
    });
  });

  describe('isTeamLeaderOrAbove', () => {
    it('should return true for TEAM_LEADER and ADMIN', () => {
      expect(isTeamLeaderOrAbove({ userId: '1', email: '', displayName: '', role: 'TEAM_LEADER' })).toBe(true);
      expect(isTeamLeaderOrAbove({ userId: '1', email: '', displayName: '', role: 'ADMIN' })).toBe(true);
    });

    it('should return false for REVIEWER', () => {
      expect(isTeamLeaderOrAbove({ userId: '1', email: '', displayName: '', role: 'REVIEWER' })).toBe(false);
    });
  });

  describe('checkUserActive', () => {
    it('should pass when user is active', async () => {
      const user = { userId: 'user-123', email: 'test@example.com', displayName: 'Test', role: 'REVIEWER' as const };

      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'user-123',
        email: 'test@example.com',
        displayName: 'Test',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(checkUserActive(user)).resolves.toBeUndefined();
    });

    it('should throw 403 when user is deactivated', async () => {
      const user = { userId: 'user-123', email: 'test@example.com', displayName: 'Test', role: 'REVIEWER' as const };

      mockGetUserByEmail.mockResolvedValueOnce({
        userId: 'user-123',
        email: 'test@example.com',
        displayName: 'Test',
        role: 'REVIEWER',
        isActive: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      try {
        await checkUserActive(user);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).statusCode).toBe(403);
        expect((e as AppError).message).toBe('アカウントが無効化されています。');
      }
    });

    it('should throw 403 when user record is not found', async () => {
      const user = { userId: 'nonexistent', email: 'notfound@example.com', displayName: 'Test', role: 'REVIEWER' as const };

      mockGetUserByEmail.mockResolvedValueOnce(null);

      try {
        await checkUserActive(user);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).statusCode).toBe(403);
        expect((e as AppError).message).toBe('ユーザーアカウントが見つかりません。');
      }
    });
  });
});
