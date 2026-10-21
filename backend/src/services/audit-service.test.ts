import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordAuditLog, searchAuditLogs, removeAuditLogs } from './audit-service.js';

vi.mock('../repositories/audit-repository.js', () => ({
  putAuditLog: vi.fn(),
  queryAuditLogs: vi.fn(),
  deleteAuditLogs: vi.fn(),
}));

vi.mock('../repositories/user-repository.js', () => ({
  findUsersByDisplayName: vi.fn(),
}));

import {
  putAuditLog,
  queryAuditLogs,
  deleteAuditLogs,
} from '../repositories/audit-repository.js';
import { findUsersByDisplayName } from '../repositories/user-repository.js';

const mockedPutAuditLog = vi.mocked(putAuditLog);
const mockedQueryAuditLogs = vi.mocked(queryAuditLogs);
const mockedDeleteAuditLogs = vi.mocked(deleteAuditLogs);
const mockedFindUsersByDisplayName = vi.mocked(findUsersByDisplayName);

describe('recordAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records an audit log entry with all required fields', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'USER_MANAGEMENT',
      resourceId: 'user-123',
      resourceType: 'User',
    });

    expect(mockedPutAuditLog).toHaveBeenCalledTimes(1);
    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.actorUserId).toBe('admin-001');
    expect(record.actorRole).toBe('ADMIN');
    expect(record.operationType).toBe('USER_MANAGEMENT');
    expect(record.resourceId).toBe('user-123');
    expect(record.resourceType).toBe('User');
    expect(record.createdAt).toBe('2024-03-15T12:00:00.000Z');
    expect(record.logId).toBeDefined();
    expect(record.logId.length).toBeGreaterThan(0);
  });

  it('records an audit log entry with metadata', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'IP_ALLOWLIST_CHANGE',
      resourceId: 'entry-456',
      resourceType: 'IPAllowlistEntry',
      metadata: { resourceName: '192.168.1.0/24', reason: 'add' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.metadata).toEqual({ resourceName: '192.168.1.0/24', reason: 'add' });
  });

  it('records audit log for REVIEWER role', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'reviewer-001',
      actorRole: 'REVIEWER',
      operationType: 'CORRECTION_CONFIRMED',
      resourceId: 'correction-789',
      resourceType: 'Correction',
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.actorRole).toBe('REVIEWER');
    expect(record.operationType).toBe('CORRECTION_CONFIRMED');
  });

  it('records audit log for TEAM_LEADER role', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'leader-001',
      actorRole: 'TEAM_LEADER',
      operationType: 'TEAM_MANAGEMENT',
      resourceId: 'team-001',
      resourceType: 'Team',
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.actorRole).toBe('TEAM_LEADER');
    expect(record.operationType).toBe('TEAM_MANAGEMENT');
  });

  it('records audit log for REVIEW_ASSIGNMENT_CHANGE operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'leader-001',
      actorRole: 'TEAM_LEADER',
      operationType: 'REVIEW_ASSIGNMENT_CHANGE',
      resourceId: 'assignment-001',
      resourceType: 'ReviewAssignment',
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('REVIEW_ASSIGNMENT_CHANGE');
    expect(record.resourceType).toBe('ReviewAssignment');
  });

  it('records audit log for TEAM_ASSIGNMENT_CHANGE operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'leader-001',
      actorRole: 'TEAM_LEADER',
      operationType: 'TEAM_ASSIGNMENT_CHANGE',
      resourceId: 'team-001:session-001',
      resourceType: 'TeamAssignment',
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('TEAM_ASSIGNMENT_CHANGE');
    expect(record.resourceType).toBe('TeamAssignment');
  });

  it('records audit log for SESSION_COMPLETED operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'reviewer-001',
      actorRole: 'REVIEWER',
      operationType: 'SESSION_COMPLETED',
      resourceId: 'session-001',
      resourceType: 'ReviewSession',
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('SESSION_COMPLETED');
    expect(record.resourceType).toBe('ReviewSession');
  });

  it('records audit log for CONSENSUS_MANUAL_CONFIRM operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'CONSENSUS_MANUAL_CONFIRM',
      resourceId: 'segment-001',
      resourceType: 'ConsensusResult',
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('CONSENSUS_MANUAL_CONFIRM');
    expect(record.resourceType).toBe('ConsensusResult');
  });

  it('records audit log for SPEAKER_LABEL_CHANGED operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'reviewer-002',
      actorRole: 'REVIEWER',
      operationType: 'SPEAKER_LABEL_CHANGED',
      resourceId: 'session-001',
      resourceType: 'Segment',
      metadata: { previousValue: 'spk_0', newValue: 'Speaker A', count: '5' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('SPEAKER_LABEL_CHANGED');
    expect(record.resourceType).toBe('Segment');
    expect(record.metadata).toEqual({ previousValue: 'spk_0', newValue: 'Speaker A', count: '5' });
  });

  it('records audit log for LOGIN_FAILURE operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'unknown-user',
      actorRole: 'REVIEWER',
      operationType: 'LOGIN_FAILURE',
      resourceId: 'auth-attempt-001',
      resourceType: 'AuthAttempt',
      metadata: { reason: 'Invalid credentials' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('LOGIN_FAILURE');
    expect(record.resourceType).toBe('AuthAttempt');
    expect(record.metadata).toEqual({ reason: 'Invalid credentials' });
  });

  it('records audit log for MEDIA_DELETED operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'leader-001',
      actorRole: 'TEAM_LEADER',
      operationType: 'MEDIA_DELETED',
      resourceId: 'media-file-001',
      resourceType: 'MediaFile',
      metadata: { resourceName: 'interview.mp3' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('MEDIA_DELETED');
    expect(record.resourceType).toBe('MediaFile');
    expect(record.metadata).toEqual({ resourceName: 'interview.mp3' });
  });

  it('records audit log for TRANSCRIPTION_DELETED operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'leader-001',
      actorRole: 'TEAM_LEADER',
      operationType: 'TRANSCRIPTION_DELETED',
      resourceId: 'session-001',
      resourceType: 'ReviewSession',
      metadata: { resourceName: 'Meeting Transcription' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('TRANSCRIPTION_DELETED');
    expect(record.resourceType).toBe('ReviewSession');
  });

  it('records audit log for PARTIAL_DELETION_FAILURE operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'leader-001',
      actorRole: 'TEAM_LEADER',
      operationType: 'PARTIAL_DELETION_FAILURE',
      resourceId: 'session-001',
      resourceType: 'ReviewSession',
      metadata: { reason: 'S3 deletion failed after DynamoDB records removed' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('PARTIAL_DELETION_FAILURE');
    expect(record.metadata).toEqual({ reason: 'S3 deletion failed after DynamoDB records removed' });
  });

  it('records audit log for LANGUAGE_MODEL_CREATED operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'LANGUAGE_MODEL_CREATED',
      resourceId: 'model-001',
      resourceType: 'LanguageModel',
      metadata: { resourceName: 'custom-model-v1' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('LANGUAGE_MODEL_CREATED');
    expect(record.resourceType).toBe('LanguageModel');
    expect(record.metadata).toEqual({ resourceName: 'custom-model-v1' });
  });

  it('records audit log for AUDIT_LOG_DELETED operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'AUDIT_LOG_DELETED',
      resourceId: 'audit-logs',
      resourceType: 'AuditLog',
      metadata: { count: '10', reason: 'Deleted 10 audit log entries matching filter conditions: operationType=LOGIN_FAILURE' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('AUDIT_LOG_DELETED');
    expect(record.resourceId).toBe('audit-logs');
    expect(record.resourceType).toBe('AuditLog');
    expect(record.metadata).toEqual({
      count: '10',
      reason: 'Deleted 10 audit log entries matching filter conditions: operationType=LOGIN_FAILURE',
    });
  });

  it('records audit log for CORRECTION_CONFIRMED operation', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'reviewer-001',
      actorRole: 'REVIEWER',
      operationType: 'CORRECTION_CONFIRMED',
      resourceId: 'correction-001',
      resourceType: 'Correction',
      metadata: { previousValue: 'old text', newValue: 'new text' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.operationType).toBe('CORRECTION_CONFIRMED');
    expect(record.metadata).toEqual({ previousValue: 'old text', newValue: 'new text' });
  });

  it('sanitizes metadata by removing disallowed keys', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'USER_MANAGEMENT',
      resourceId: 'user-123',
      resourceType: 'User',
      metadata: { resourceName: 'test', secretKey: 'should-be-removed', password: 'hidden' },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.metadata).toEqual({ resourceName: 'test' });
    expect(record.metadata).not.toHaveProperty('secretKey');
    expect(record.metadata).not.toHaveProperty('password');
  });

  it('sanitizes metadata by truncating values exceeding 1000 characters', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    const longValue = 'x'.repeat(1500);
    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'USER_MANAGEMENT',
      resourceId: 'user-123',
      resourceType: 'User',
      metadata: { reason: longValue },
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.metadata!.reason).toHaveLength(1000);
  });

  it('generates unique logId for each entry', async () => {
    mockedPutAuditLog.mockResolvedValue(undefined);

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'USER_MANAGEMENT',
      resourceId: 'user-1',
      resourceType: 'User',
    });

    await recordAuditLog({
      actorUserId: 'admin-001',
      actorRole: 'ADMIN',
      operationType: 'USER_MANAGEMENT',
      resourceId: 'user-2',
      resourceType: 'User',
    });

    const logId1 = mockedPutAuditLog.mock.calls[0][0].logId;
    const logId2 = mockedPutAuditLog.mock.calls[1][0].logId;
    expect(logId1).not.toBe(logId2);
  });
});

describe('searchAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to queryAuditLogs with params', async () => {
    mockedQueryAuditLogs.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    const params = {
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-01-31T23:59:59.999Z',
      actorUserId: 'user-001',
      page: 2,
    };

    await searchAuditLogs(params);

    expect(mockedQueryAuditLogs).toHaveBeenCalledWith(params);
  });

  it('returns query result as-is', async () => {
    const expectedResult = {
      items: [
        {
          logId: 'log-001',
          createdAt: '2024-01-15T10:00:00.000Z',
          actorUserId: 'admin-001',
          actorRole: 'ADMIN' as const,
          operationType: 'USER_MANAGEMENT' as const,
          resourceId: 'user-123',
          resourceType: 'User',
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    };
    mockedQueryAuditLogs.mockResolvedValue(expectedResult);

    const result = await searchAuditLogs({});
    expect(result).toEqual(expectedResult);
  });

  it('resolves actorName to matching user IDs and queries by actorUserIds', async () => {
    mockedFindUsersByDisplayName.mockResolvedValue([
      {
        userId: 'user-001',
        email: 'a@example.com',
        displayName: '山田太郎',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        userId: 'user-002',
        email: 'b@example.com',
        displayName: '山田太郎',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    mockedQueryAuditLogs.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    await searchAuditLogs({ actorName: '山田太郎', page: 1 });

    expect(mockedFindUsersByDisplayName).toHaveBeenCalledWith('山田太郎');
    expect(mockedQueryAuditLogs).toHaveBeenCalledWith({
      actorUserId: undefined,
      actorUserIds: ['user-001', 'user-002'],
      page: 1,
    });
  });

  it('passes empty actorUserIds when actorName matches no user', async () => {
    mockedFindUsersByDisplayName.mockResolvedValue([]);
    mockedQueryAuditLogs.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    await searchAuditLogs({ actorName: '存在しない名前' });

    expect(mockedQueryAuditLogs).toHaveBeenCalledWith({
      actorUserId: undefined,
      actorUserIds: [],
    });
  });

  it('does not resolve actorName when it is blank, honoring actorUserId', async () => {
    mockedQueryAuditLogs.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    await searchAuditLogs({ actorName: '   ', actorUserId: 'user-001' });

    expect(mockedFindUsersByDisplayName).not.toHaveBeenCalled();
    expect(mockedQueryAuditLogs).toHaveBeenCalledWith({ actorUserId: 'user-001' });
  });
});

describe('removeAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes logs matching date range filter', async () => {
    mockedDeleteAuditLogs.mockResolvedValue(5);
    mockedPutAuditLog.mockResolvedValue(undefined);

    const result = await removeAuditLogs(
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
      },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(result).toBe(5);
    expect(mockedDeleteAuditLogs).toHaveBeenCalledWith({
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-01-31T23:59:59.999Z',
      actorUserId: undefined,
      operationType: undefined,
    });
  });

  it('deletes logs matching actorUserId filter', async () => {
    mockedDeleteAuditLogs.mockResolvedValue(3);
    mockedPutAuditLog.mockResolvedValue(undefined);

    const result = await removeAuditLogs(
      { actorUserId: 'user-001' },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(result).toBe(3);
    expect(mockedDeleteAuditLogs).toHaveBeenCalledWith({
      startDate: undefined,
      endDate: undefined,
      actorUserId: 'user-001',
      operationType: undefined,
    });
  });

  it('deletes logs matching operationType filter', async () => {
    mockedDeleteAuditLogs.mockResolvedValue(10);
    mockedPutAuditLog.mockResolvedValue(undefined);

    const result = await removeAuditLogs(
      { operationType: 'IP_ALLOWLIST_CHANGE' },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(result).toBe(10);
  });

  it('returns 0 when no filter is provided (safety guard)', async () => {
    const result = await removeAuditLogs({});

    expect(result).toBe(0);
    expect(mockedDeleteAuditLogs).not.toHaveBeenCalled();
  });

  it('deletes with combined filters', async () => {
    mockedDeleteAuditLogs.mockResolvedValue(2);
    mockedPutAuditLog.mockResolvedValue(undefined);

    const result = await removeAuditLogs(
      {
        startDate: '2024-01-01T00:00:00.000Z',
        actorUserId: 'admin-001',
        operationType: 'USER_MANAGEMENT',
      },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(result).toBe(2);
  });

  it('records the deletion operation itself as AUDIT_LOG_DELETED', async () => {
    mockedDeleteAuditLogs.mockResolvedValue(5);
    mockedPutAuditLog.mockResolvedValue(undefined);

    await removeAuditLogs(
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
        operationType: 'USER_MANAGEMENT',
      },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(mockedPutAuditLog).toHaveBeenCalledTimes(1);
    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.actorUserId).toBe('admin-001');
    expect(record.actorRole).toBe('ADMIN');
    expect(record.operationType).toBe('AUDIT_LOG_DELETED');
    expect(record.resourceId).toBe('audit-logs');
    expect(record.resourceType).toBe('AuditLog');
    expect(record.metadata).toEqual({
      count: '5',
      reason: 'Deleted 5 audit log entries matching filter conditions: startDate=2024-01-01T00:00:00.000Z, endDate=2024-01-31T23:59:59.999Z, operationType=USER_MANAGEMENT',
    });
  });

  it('records deletion with 0 deleted count', async () => {
    mockedDeleteAuditLogs.mockResolvedValue(0);
    mockedPutAuditLog.mockResolvedValue(undefined);

    await removeAuditLogs(
      { actorUserId: 'user-999' },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(mockedPutAuditLog).toHaveBeenCalledTimes(1);
    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.metadata).toEqual({
      count: '0',
      reason: 'Deleted 0 audit log entries matching filter conditions: actorUserId=user-999',
    });
  });

  it('does not record deletion when no actor is provided', async () => {
    mockedDeleteAuditLogs.mockResolvedValue(3);

    await removeAuditLogs({ actorUserId: 'user-001' });

    expect(mockedPutAuditLog).not.toHaveBeenCalled();
  });

  it('resolves actorName to user IDs before deleting', async () => {
    mockedFindUsersByDisplayName.mockResolvedValue([
      {
        userId: 'user-001',
        email: 'a@example.com',
        displayName: '山田太郎',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    mockedDeleteAuditLogs.mockResolvedValue(2);
    mockedPutAuditLog.mockResolvedValue(undefined);

    const result = await removeAuditLogs(
      { actorName: '山田太郎' },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(result).toBe(2);
    expect(mockedFindUsersByDisplayName).toHaveBeenCalledWith('山田太郎');
    expect(mockedDeleteAuditLogs).toHaveBeenCalledWith({
      startDate: undefined,
      endDate: undefined,
      actorUserId: undefined,
      actorUserIds: ['user-001'],
      operationType: undefined,
    });

    const record = mockedPutAuditLog.mock.calls[0][0];
    expect(record.metadata).toEqual({
      count: '2',
      reason:
        'Deleted 2 audit log entries matching filter conditions: actorName=山田太郎',
    });
  });

  it('returns 0 without deleting when only actorName is given but no filter resolves', async () => {
    // actorName alone is a valid filter; an empty match set must delete nothing.
    mockedFindUsersByDisplayName.mockResolvedValue([]);
    mockedDeleteAuditLogs.mockResolvedValue(0);

    const result = await removeAuditLogs(
      { actorName: '存在しない名前' },
      { userId: 'admin-001', role: 'ADMIN' }
    );

    expect(result).toBe(0);
    expect(mockedDeleteAuditLogs).toHaveBeenCalledWith({
      startDate: undefined,
      endDate: undefined,
      actorUserId: undefined,
      actorUserIds: [],
      operationType: undefined,
    });
  });
});
