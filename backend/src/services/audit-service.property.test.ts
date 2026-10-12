import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const mockPutAuditLog = vi.fn().mockResolvedValue(undefined);
const mockDeleteAuditLogs = vi.fn();

vi.mock('../repositories/audit-repository.js', () => ({
  putAuditLog: (...args: unknown[]) => mockPutAuditLog(...args),
  queryAuditLogs: vi.fn(),
  deleteAuditLogs: (...args: unknown[]) => mockDeleteAuditLogs(...args),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import { removeAuditLogs } from './audit-service.js';

describe('Feature: audit-log-management, Property 45: AuditLog 削除の自己記録', () => {
  /**
   * **Validates: Requirements 14.12**
   * When audit logs are deleted, the deletion operation itself is recorded as an audit log entry
   * with operationType: AUDIT_LOG_DELETED, including the deleter's userId, the count of deleted
   * entries, and the deletion conditions.
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const userIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,36}$/);
  const roleArb = fc.constantFrom('REVIEWER' as const, 'TEAM_LEADER' as const, 'ADMIN' as const);
  const dateArb = fc.date({
    min: new Date('2020-01-01'),
    max: new Date('2030-12-31'),
  }).map((d) => d.toISOString().substring(0, 10));
  const operationTypeArb = fc.constantFrom(
    'IP_ALLOWLIST_CHANGE' as const,
    'USER_MANAGEMENT' as const,
    'TEAM_MANAGEMENT' as const,
    'REVIEW_ASSIGNMENT_CHANGE' as const,
    'TEAM_ASSIGNMENT_CHANGE' as const,
    'SESSION_COMPLETED' as const,
    'CONSENSUS_MANUAL_CONFIRM' as const,
    'CORRECTION_CONFIRMED' as const,
    'SPEAKER_LABEL_CHANGED' as const,
    'LOGIN_FAILURE' as const,
    'MEDIA_DELETED' as const,
    'TRANSCRIPTION_DELETED' as const,
    'PARTIAL_DELETION_FAILURE' as const,
    'LANGUAGE_MODEL_CREATED' as const,
    'AUDIT_LOG_DELETED' as const,
  );

  const deletedCountArb = fc.nat({ max: 500 });

  const filterParamsArb = fc.record({
    startDate: fc.option(dateArb, { nil: undefined }),
    endDate: fc.option(dateArb, { nil: undefined }),
    actorUserId: fc.option(userIdArb, { nil: undefined }),
    operationType: fc.option(operationTypeArb, { nil: undefined }),
  }).filter((params) =>
    // At least one filter must be provided (service requires this)
    params.startDate !== undefined ||
    params.endDate !== undefined ||
    params.actorUserId !== undefined ||
    params.operationType !== undefined
  );

  it('deletion operation is recorded with operationType AUDIT_LOG_DELETED', async () => {
    await fc.assert(
      fc.asyncProperty(
        filterParamsArb,
        userIdArb,
        roleArb,
        deletedCountArb,
        async (filterParams, userId, role, deletedCount) => {
          vi.clearAllMocks();
          mockDeleteAuditLogs.mockResolvedValue(deletedCount);

          await removeAuditLogs(filterParams, { userId, role });

          // The self-recording call is the putAuditLog invocation
          expect(mockPutAuditLog).toHaveBeenCalled();

          const recordedEntry = mockPutAuditLog.mock.calls[0][0];
          expect(recordedEntry.operationType).toBe('AUDIT_LOG_DELETED');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('recorded entry includes the deleter userId and role', async () => {
    await fc.assert(
      fc.asyncProperty(
        filterParamsArb,
        userIdArb,
        roleArb,
        deletedCountArb,
        async (filterParams, userId, role, deletedCount) => {
          vi.clearAllMocks();
          mockDeleteAuditLogs.mockResolvedValue(deletedCount);

          await removeAuditLogs(filterParams, { userId, role });

          const recordedEntry = mockPutAuditLog.mock.calls[0][0];
          expect(recordedEntry.actorUserId).toBe(userId);
          expect(recordedEntry.actorRole).toBe(role);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('recorded entry includes the count of deleted entries in metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        filterParamsArb,
        userIdArb,
        roleArb,
        deletedCountArb,
        async (filterParams, userId, role, deletedCount) => {
          vi.clearAllMocks();
          mockDeleteAuditLogs.mockResolvedValue(deletedCount);

          await removeAuditLogs(filterParams, { userId, role });

          const recordedEntry = mockPutAuditLog.mock.calls[0][0];
          expect(recordedEntry.metadata).toBeDefined();
          expect(recordedEntry.metadata.count).toBe(String(deletedCount));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('recorded entry includes the deletion conditions in metadata reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        filterParamsArb,
        userIdArb,
        roleArb,
        deletedCountArb,
        async (filterParams, userId, role, deletedCount) => {
          vi.clearAllMocks();
          mockDeleteAuditLogs.mockResolvedValue(deletedCount);

          await removeAuditLogs(filterParams, { userId, role });

          const recordedEntry = mockPutAuditLog.mock.calls[0][0];
          const reason = recordedEntry.metadata.reason as string;
          expect(reason).toBeDefined();

          // Verify deletion conditions are included in the reason string
          if (filterParams.startDate !== undefined) {
            expect(reason).toContain(filterParams.startDate);
          }
          if (filterParams.endDate !== undefined) {
            expect(reason).toContain(filterParams.endDate);
          }
          if (filterParams.actorUserId !== undefined) {
            expect(reason).toContain(filterParams.actorUserId);
          }
          if (filterParams.operationType !== undefined) {
            expect(reason).toContain(filterParams.operationType);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
