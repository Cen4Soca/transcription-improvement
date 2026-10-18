import type { UserRole } from './user';

/**
 * AuditLog - 操作の監査記録
 */
export interface AuditLog {
  logId: string;
  createdAt: string;
  actorUserId: string;
  actorRole: UserRole;
  operationType: AuditOperationType;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

export type AuditOperationType =
  | 'IP_ALLOWLIST_CHANGE'
  | 'USER_MANAGEMENT'
  | 'TEAM_MANAGEMENT'
  | 'REVIEW_ASSIGNMENT_CHANGE'
  | 'TEAM_ASSIGNMENT_CHANGE'
  | 'SESSION_COMPLETED'
  | 'CONSENSUS_MANUAL_CONFIRM'
  | 'CORRECTION_CONFIRMED'
  | 'SPEAKER_LABEL_CHANGED'
  | 'LOGIN_FAILURE'
  | 'MEDIA_DELETED'
  | 'TRANSCRIPTION_DELETED'
  | 'PARTIAL_DELETION_FAILURE'
  | 'LANGUAGE_MODEL_CREATED'
  | 'AUDIT_LOG_DELETED';

/**
 * IPAllowlistEntry - IPアドレス許可リストのエントリ
 */
export interface IPAllowlistEntry {
  entryId: string;
  cidr: string;
  description?: string;
  createdAt: string;
  createdBy: string;
}
