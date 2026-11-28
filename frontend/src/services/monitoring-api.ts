import type { ApiClient } from './api-client';
import type { Result, AppError, PaginatedResponse } from '../types/api';
import type {
  MonitoringSessionItem,
  SessionProgress,
  SessionMonitoringFilters,
  UserWorkloadItem,
  UserSessionItem,
} from '../types/monitoring';

/**
 * MonitoringApi - セッション割当・進捗モニタリング API クライアント（ADMIN / TEAM_LEADER）
 *
 * - GET /sessions/monitoring: 割当状況・ステータス・未割当/滞留フラグ
 * - GET /sessions/{sessionId}/progress: Reviewer 別進捗
 * - GET /monitoring/users: ユーザー別の担当数 / 進行中数 / 滞留数
 * - GET /monitoring/users/{userId}/sessions: ユーザーの担当セッションと進捗
 */
export class MonitoringApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  async listSessions(
    filters: SessionMonitoringFilters = {}
  ): Promise<Result<{ data: PaginatedResponse<MonitoringSessionItem> }, AppError>> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.teamId) params.set('teamId', filters.teamId);
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.unassignedOnly) params.set('unassignedOnly', 'true');
    if (filters.stalledOnly) params.set('stalledOnly', 'true');
    if (filters.page && filters.page > 1) params.set('page', String(filters.page));
    const query = params.toString();
    return this.client.get<{ data: PaginatedResponse<MonitoringSessionItem> }>(
      `/sessions/monitoring${query ? `?${query}` : ''}`
    );
  }

  async getSessionProgress(
    sessionId: string
  ): Promise<Result<{ data: SessionProgress }, AppError>> {
    return this.client.get<{ data: SessionProgress }>(
      `/sessions/${encodeURIComponent(sessionId)}/progress`
    );
  }

  async listUserWorkload(): Promise<
    Result<{ data: { items: UserWorkloadItem[] } }, AppError>
  > {
    return this.client.get<{ data: { items: UserWorkloadItem[] } }>('/monitoring/users');
  }

  async listUserSessions(
    userId: string
  ): Promise<Result<{ data: { items: UserSessionItem[] } }, AppError>> {
    return this.client.get<{ data: { items: UserSessionItem[] } }>(
      `/monitoring/users/${encodeURIComponent(userId)}/sessions`
    );
  }
}
