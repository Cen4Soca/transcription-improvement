import type { ReviewSessionStatus } from './session';

/**
 * セッション割当・進捗モニタリング（ADMIN / TEAM_LEADER 向け）の型。
 * バックエンド monitoring-service と同じ形（型は frontend / backend で重複管理する）。
 */

/** GET /sessions/monitoring の 1 行 */
export interface MonitoringSessionItem {
  sessionId: string;
  name: string;
  status: ReviewSessionStatus;
  assignedUserId?: string;
  assignedUserName?: string;
  assignedTeamId?: string;
  assignedTeamName?: string;
  participantCount: number;
  isUnassigned: boolean;
  isStalled: boolean;
  /** 最終活動日時。IN_PROGRESS 以外は算出されず null。 */
  lastActivityAt: string | null;
  createdAt: string;
}

/** GET /sessions/{sessionId}/progress の Reviewer 別進捗 */
export interface ReviewerProgress {
  userId: string;
  displayName: string;
  correctedSegments: number;
  totalSegments: number;
  progressPercent: number;
  lastActivityAt: string | null;
}

export interface SessionProgress {
  sessionId: string;
  name: string;
  status: ReviewSessionStatus;
  totalSegments: number;
  isStalled: boolean;
  lastActivityAt: string | null;
  reviewers: ReviewerProgress[];
}

/** GET /monitoring/users の 1 行 */
export interface UserWorkloadItem {
  userId: string;
  displayName: string;
  email: string;
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  isActive: boolean;
  assignedCount: number;
  inProgressCount: number;
  stalledCount: number;
}

/** GET /monitoring/users/{userId}/sessions の 1 行 */
export interface UserSessionItem {
  sessionId: string;
  name: string;
  status: ReviewSessionStatus;
  assignedTeamId?: string;
  assignedTeamName?: string;
  isStalled: boolean;
  lastActivityAt: string | null;
  correctedSegments: number;
  totalSegments: number;
  progressPercent: number;
}

export interface SessionMonitoringFilters {
  status?: ReviewSessionStatus;
  teamId?: string;
  userId?: string;
  unassignedOnly?: boolean;
  stalledOnly?: boolean;
  page?: number;
}
