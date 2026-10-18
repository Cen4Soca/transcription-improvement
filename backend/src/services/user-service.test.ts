import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repositories/user-repository.js', () => ({
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('./cognito-service.js', () => ({
  updateCognitoUserAttributes: vi.fn(),
}));

vi.mock('./audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import {
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  type UserRecord,
} from '../repositories/user-repository.js';
import { updateCognitoUserAttributes } from './cognito-service.js';
import { recordAuditLog } from './audit-service.js';
import {
  updateUserProfile,
  validateProfileFields,
  provisionUserOnFirstLogin,
} from './user-service.js';

const mockedGetUserById = vi.mocked(getUserById);
const mockedGetUserByEmail = vi.mocked(getUserByEmail);
const mockedCreateUser = vi.mocked(createUser);
const mockedUpdateUser = vi.mocked(updateUser);
const mockedUpdateCognito = vi.mocked(updateCognitoUserAttributes);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

const existingUser: UserRecord = {
  userId: 'user-001',
  email: 'old@example.com',
  displayName: 'Old Name',
  role: 'REVIEWER',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const actor = { userId: 'admin-001', role: 'ADMIN' as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetUserById.mockResolvedValue(existingUser);
  mockedUpdateUser.mockImplementation(async (_userId, input) => ({
    ...existingUser,
    ...input,
    updatedAt: '2026-02-01T00:00:00.000Z',
  }));
});

describe('validateProfileFields', () => {
  it('trims displayName and lowercases email', () => {
    const result = validateProfileFields({
      displayName: '  New Name  ',
      email: '  New@Example.COM  ',
    });
    expect(result).toEqual({ displayName: 'New Name', email: 'new@example.com' });
  });

  it('throws when no field is provided', () => {
    expect(() => validateProfileFields({})).toThrow();
  });

  it('throws on empty displayName', () => {
    expect(() => validateProfileFields({ displayName: '   ' })).toThrow();
  });

  it('throws on invalid email format', () => {
    expect(() => validateProfileFields({ email: 'not-an-email' })).toThrow();
  });
});

describe('updateUserProfile', () => {
  it('updates displayName in Cognito and DynamoDB and records audit log', async () => {
    const result = await updateUserProfile({
      actor,
      targetUserId: 'user-001',
      fields: { displayName: 'New Name' },
    });

    expect(mockedUpdateCognito).toHaveBeenCalledWith('old@example.com', {
      displayName: 'New Name',
    });
    expect(mockedUpdateUser).toHaveBeenCalledWith('user-001', {
      displayName: 'New Name',
    });
    expect(mockedRecordAuditLog).toHaveBeenCalledTimes(1);
    expect(result.displayName).toBe('New Name');
  });

  it('checks email uniqueness before updating email', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);

    await updateUserProfile({
      actor,
      targetUserId: 'user-001',
      fields: { email: 'new@example.com' },
    });

    expect(mockedGetUserByEmail).toHaveBeenCalledWith('new@example.com');
    expect(mockedUpdateCognito).toHaveBeenCalledWith('old@example.com', {
      email: 'new@example.com',
    });
    expect(mockedUpdateUser).toHaveBeenCalledWith('user-001', {
      email: 'new@example.com',
    });
  });

  it('rejects email already used by another user', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      ...existingUser,
      userId: 'user-999',
      email: 'new@example.com',
    });

    await expect(
      updateUserProfile({
        actor,
        targetUserId: 'user-001',
        fields: { email: 'new@example.com' },
      })
    ).rejects.toThrow();

    expect(mockedUpdateUser).not.toHaveBeenCalled();
  });

  it('allows keeping the same email (no uniqueness conflict with self)', async () => {
    const result = await updateUserProfile({
      actor,
      targetUserId: 'user-001',
      fields: { email: 'old@example.com', displayName: 'New Name' },
    });

    // email unchanged → no uniqueness lookup, no email in update payload
    expect(mockedGetUserByEmail).not.toHaveBeenCalled();
    expect(mockedUpdateUser).toHaveBeenCalledWith('user-001', {
      displayName: 'New Name',
    });
    expect(result.displayName).toBe('New Name');
  });

  it('returns existing user without side effects when nothing changed', async () => {
    const result = await updateUserProfile({
      actor,
      targetUserId: 'user-001',
      fields: { displayName: 'Old Name', email: 'old@example.com' },
    });

    expect(mockedUpdateCognito).not.toHaveBeenCalled();
    expect(mockedUpdateUser).not.toHaveBeenCalled();
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    expect(result).toEqual(existingUser);
  });

  it('throws notFound when target user does not exist', async () => {
    mockedGetUserById.mockResolvedValue(null);

    await expect(
      updateUserProfile({
        actor,
        targetUserId: 'missing',
        fields: { displayName: 'X' },
      })
    ).rejects.toThrow();
  });
});

describe('provisionUserOnFirstLogin', () => {
  it('creates a REVIEWER record (active) using the custom:displayName claim and audits it', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateUser.mockImplementation(async (input) => ({
      ...input,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = await provisionUserOnFirstLogin({
      email: 'New@Example.COM',
      displayName: '  Jit User  ',
    });

    expect(mockedCreateUser).toHaveBeenCalledTimes(1);
    const createArg = mockedCreateUser.mock.calls[0][0];
    expect(createArg.email).toBe('new@example.com'); // normalized
    expect(createArg.displayName).toBe('Jit User'); // trimmed claim
    expect(createArg.role).toBe('REVIEWER');
    expect(typeof createArg.userId).toBe('string');
    expect(createArg.userId.length).toBeGreaterThan(0);

    expect(result.role).toBe('REVIEWER');
    expect(result.isActive).toBe(true);

    expect(mockedRecordAuditLog).toHaveBeenCalledTimes(1);
    const auditArg = mockedRecordAuditLog.mock.calls[0][0];
    expect(auditArg.operationType).toBe('USER_AUTO_PROVISIONED');
    expect(auditArg.resourceType).toBe('User');
    expect(auditArg.resourceId).toBe(result.userId);
  });

  it('derives displayName from the email local-part when the claim is absent', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateUser.mockImplementation(async (input) => ({
      ...input,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = await provisionUserOnFirstLogin({ email: 'local-part@example.com' });

    expect(mockedCreateUser.mock.calls[0][0].displayName).toBe('local-part');
    expect(result.displayName).toBe('local-part');
    expect(result.role).toBe('REVIEWER');
  });

  it('is idempotent: returns the existing record without creating or auditing', async () => {
    const existing: UserRecord = {
      userId: 'user-existing',
      email: 'exists@example.com',
      displayName: 'Exists',
      role: 'ADMIN',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mockedGetUserByEmail.mockResolvedValue(existing);

    const result = await provisionUserOnFirstLogin({ email: 'exists@example.com' });

    expect(mockedCreateUser).not.toHaveBeenCalled();
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    expect(result).toEqual(existing);
  });

  it('tolerates a concurrent-create race: falls back to the record created by the winner', async () => {
    const raced: UserRecord = {
      userId: 'winner-user',
      email: 'race@example.com',
      displayName: 'race',
      role: 'REVIEWER',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    // First lookup: absent → attempt create. Second lookup (after failure): found.
    mockedGetUserByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);
    mockedCreateUser.mockRejectedValue(
      Object.assign(new Error('The conditional request failed'), {
        name: 'ConditionalCheckFailedException',
      })
    );

    const result = await provisionUserOnFirstLogin({ email: 'race@example.com' });

    expect(result).toEqual(raced);
    // No audit for a provision we did not perform.
    expect(mockedRecordAuditLog).not.toHaveBeenCalled();
  });

  it('still provisions when the audit write fails (warning logged, no throw)', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateUser.mockImplementation(async (input) => ({
      ...input,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    mockedRecordAuditLog.mockRejectedValue(new Error('audit down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await provisionUserOnFirstLogin({
      email: 'audit-fail@example.com',
      displayName: 'Audit Fail',
    });

    expect(result.role).toBe('REVIEWER');
    expect(result.isActive).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
