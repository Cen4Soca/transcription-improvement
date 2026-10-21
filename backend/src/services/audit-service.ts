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
  type AuditLogQueryResult,
} from '../repositories/audit-repository.js';
import { sanitizeMetadata } from '../utils/metadata-sanitizer.js';
import { findUsersByDisplayName } from '../repositories/user-repository.js';

export type { AuditOperationType, AuditLogRecord, AuditLogQueryResult };

export interface RecordAuditLogParams {
  actorUserId: string;
  actorRole: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  operationType: AuditOperationType;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

export interface SearchAuditLogsParams {
  startDate?: string;
  endDate?: string;
  /** Filter by actor user ID (exact match). */
  actorUserId?: string;
  /**
   * Filter by actor display name (case-insensitive, substring match).
   * Resolved to the matching user IDs before querying. Takes precedence over
   * actorUserId when both are provided.
   */
  actorName?: string;
  operationType?: AuditOperationType;
  page?: number;
}

export interface DeleteAuditLogsParams {
  startDate?: string;
  endDate?: string;
  actorUserId?: string;
  actorName?: string;
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
 * - actorUserId: Filter by actor user ID
 * - actorName: Filter by actor display name (substring, case-insensitive).
 *   Resolved to user IDs; takes precedence over actorUserId.
 * - operationType: Filter by operation type
 *
 * Returns max 100 entries per page.
 */
export async function searchAuditLogs(
  params: SearchAuditLogsParams
): Promise<AuditLogQueryResult> {
  const queryParams = await resolveActorName(params);
  return queryAuditLogs(queryParams);
}

/**
 * Translate an actorName filter into the actorUserIds the repository expects.
 *
 * - actorName present: resolve to matching user IDs (possibly empty, meaning
 *   "no user matched" -> no results). actorUserId is dropped in favor of the
 *   name match.
 * - actorName absent: pass through unchanged (actorUserId still honored).
 */
async function resolveActorName<
  T extends { actorName?: string; actorUserId?: string }
>(params: T): Promise<Omit<T, 'actorName'> & { actorUserIds?: string[] }> {
  const { actorName, ...rest } = params;

  if (actorName && actorName.trim().length > 0) {
    const matchedUsers = await findUsersByDisplayName(actorName);
    return {
      ...rest,
      actorUserId: undefined,
      actorUserIds: matchedUsers.map((u) => u.userId),
    };
  }

  return rest;
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
  const { startDate, endDate, actorUserId, actorName, operationType } = params;

  // Require at least one filter to prevent accidental full deletion
  if (!startDate && !endDate && !actorUserId && !actorName && !operationType) {
    return 0;
  }

  const resolved = await resolveActorName({ startDate, endDate, actorUserId, actorName, operationType });

  const deletedCount = await deleteAuditLogs(resolved);

  // Record the deletion operation itself in the audit log
  if (actor && deletedCount >= 0) {
    const conditionParts: string[] = [];
    if (startDate) conditionParts.push(`startDate=${startDate}`);
    if (endDate) conditionParts.push(`endDate=${endDate}`);
    if (actorUserId) conditionParts.push(`actorUserId=${actorUserId}`);
    if (actorName) conditionParts.push(`actorName=${actorName}`);
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
