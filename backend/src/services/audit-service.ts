/**
 * Audit Service
 *
 * Business logic for recording and managing audit log entries.
 * Provides a central function to record audit logs for all tracked operations.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  putAuditLog,
  queryAuditLogs,
  deleteAuditLogs,
  type AuditOperationType,
  type AuditLogRecord,
  type AuditLogQueryParams,
  type AuditLogQueryResult,
} from '../repositories/audit-repository.js';
import { sanitizeMetadata } from '../utils/metadata-sanitizer.js';

export type { AuditOperationType, AuditLogRecord, AuditLogQueryResult };

export interface RecordAuditLogParams {
  actorUserId: string;
  actorRole: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  operationType: AuditOperationType;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

export interface DeleteAuditLogsParams {
  startDate?: string;
  endDate?: string;
  actorUserId?: string;
  operationType?: AuditOperationType;
}

/**
 * Record an audit log entry.
 *
 * Each entry includes:
 * - Operation timestamp (ISO 8601 UTC)
 * - Actor user ID
 * - Actor role
 * - Operation type
 * - Target resource ID
 * - Target resource type
 * - Optional metadata
 *
 * Entries are stored indefinitely (no TTL) unless explicitly deleted by Admin.
 */
export async function recordAuditLog(params: RecordAuditLogParams): Promise<void> {
  const {
    actorUserId,
    actorRole,
    operationType,
    resourceId,
    resourceType,
    metadata,
  } = params;

  const logId = uuidv4();
  const createdAt = new Date().toISOString();

  const sanitizedMetadata = sanitizeMetadata(metadata);

  const record: AuditLogRecord = {
    logId,
    createdAt,
    actorUserId,
    actorRole,
    operationType,
    resourceId,
    resourceType,
    metadata: sanitizedMetadata,
  };

  await putAuditLog(record);
}

/**
 * Search audit logs with filters and pagination.
 *
 * Filters:
 * - startDate / endDate: Date range (ISO 8601)
 * - actorUserId: Filter by actor
 * - operationType: Filter by operation type
 *
 * Returns max 100 entries per page.
 */
export async function searchAuditLogs(
  params: AuditLogQueryParams
): Promise<AuditLogQueryResult> {
  return queryAuditLogs(params);
}

/**
 * Delete audit log entries matching the given filter criteria.
 * Records the deletion operation itself as an audit log entry (AUDIT_LOG_DELETED).
 *
 * At least one filter must be provided to prevent accidental deletion of all logs.
 * Returns the number of deleted entries.
 */
export async function removeAuditLogs(
  params: DeleteAuditLogsParams,
  actor?: { userId: string; role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN' }
): Promise<number> {
  const { startDate, endDate, actorUserId, operationType } = params;

  // Require at least one filter to prevent accidental full deletion
  if (!startDate && !endDate && !actorUserId && !operationType) {
    return 0;
  }

  const deletedCount = await deleteAuditLogs({ startDate, endDate, actorUserId, operationType });

  // Record the deletion operation itself in the audit log
  if (actor && deletedCount >= 0) {
    const conditionParts: string[] = [];
    if (startDate) conditionParts.push(`startDate=${startDate}`);
    if (endDate) conditionParts.push(`endDate=${endDate}`);
    if (actorUserId) conditionParts.push(`actorUserId=${actorUserId}`);
    if (operationType) conditionParts.push(`operationType=${operationType}`);

    await recordAuditLog({
      actorUserId: actor.userId,
      actorRole: actor.role,
      operationType: 'AUDIT_LOG_DELETED',
      resourceId: 'audit-logs',
      resourceType: 'AuditLog',
      metadata: {
        count: String(deletedCount),
        reason: `Deleted ${deletedCount} audit log entries matching filter conditions: ${conditionParts.join(', ')}`,
      },
    });
  }

  return deletedCount;
}
