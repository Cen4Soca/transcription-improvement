import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';
import type { AuditLog, AuditOperationType, IPAllowlistEntry } from '../types/audit';
import type { User, UserRole } from '../types/user';
import type { Team, TeamMembership, TeamAssignment } from '../types/team';
import type { ReviewSession } from '../types/session';

/**
 * AdminApi - 管理画面用 API クライアント
 *
 * - GET /admin/users: ユーザー一覧取得
 * - POST /admin/users: ユーザー作成
 * - PATCH /admin/users/{userId}: ユーザー更新（ロール変更・無効化）
 * - GET /admin/teams: チーム一覧取得
 * - POST /admin/teams: チーム作成
 * - PATCH /admin/teams/{teamId}: チーム更新
 * - DELETE /admin/teams/{teamId}: チーム削除
 * - GET /admin/teams/{teamId}/members: チームメンバー取得
 * - POST /admin/teams/{teamId}/members: メンバー追加
 * - DELETE /admin/teams/{teamId}/members/{userId}: メンバー削除
 * - GET /admin/ip-allowlist: IPアドレス許可リスト取得
 * - POST /admin/ip-allowlist: IPアドレスエントリ追加
 * - DELETE /admin/ip-allowlist/{entryId}: IPアドレスエントリ削除
 * - GET /admin/audit-logs: 監査ログ検索
 * - POST /admin/audit-logs/delete: 監査ログ削除
 * - PATCH /admin/settings/consensus: Consensus設定更新
 * - GET /admin/settings/ranking: ランキング設定取得
 * - PATCH /admin/settings/ranking: ランキング設定更新
 *
 * Requirements: 9.2, 13.1, 13.4, 14.3, 14.7, 14.11, 14.13
 */

// --- User management types ---

export interface CreateUserRequest {
  email: string;
  displayName: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  role?: UserRole;
  isActive?: boolean;
  displayName?: string;
  email?: string;
}

export interface UsersResponse {
  data: User[];
}

export interface UserResponse {
  data: User;
}

// --- Team management types ---

export interface CreateTeamRequest {
  name: string;
  members?: string[];
}

export interface UpdateTeamRequest {
  name: string;
}

export interface TeamsResponse {
  data: Team[];
}

export interface TeamResponse {
  data: Team;
}

export interface TeamMembersResponse {
  data: TeamMembership[];
}

export interface TeamMembershipResponse {
  data: TeamMembership;
}

export interface TeamAssignmentsResponse {
  data: TeamAssignment[];
}

export interface SessionsResponse {
  data: ReviewSession[];
}

/**
 * RawTeamAssignment - バックエンド生レコード
 * (team-assignments.ts / team-repository.ts)。
 * フロント型 TeamAssignment と異なり createdBy/createdAt を持つ。
 */
export interface RawTeamAssignment {
  teamId: string;
  sessionId: string;
  createdBy: string;
  createdAt: string;
}

/**
 * バックエンド生レコードをフロント型 TeamAssignment にマッピングする。
 * createdBy → assignedBy, createdAt → assignedAt（サービス層マッピング）。
 */
export function mapAssignment(raw: RawTeamAssignment): TeamAssignment {
  return {
    teamId: raw.teamId,
    sessionId: raw.sessionId,
    assignedBy: raw.createdBy,
    assignedAt: raw.createdAt,
  };
}

// --- IP allowlist types ---

export interface AddIPEntryRequest {
  cidr: string;
  description?: string;
}

export interface IPAllowlistResponse {
  data: IPAllowlistEntry[];
}

export interface AddIPEntryResponse {
  data: IPAllowlistEntry;
}

export interface DeleteIPEntryResponse {
  data: { message: string };
}

// --- Audit log types ---

export interface AuditLogSearchParams {
  startDate?: string;
  endDate?: string;
  actorUserId?: string;
  operationType?: AuditOperationType | '';
  page?: number;
}

export interface AuditLogSearchResponse {
  data: AuditLog[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface DeleteAuditLogsRequest {
  startDate?: string;
  endDate?: string;
  actorUserId?: string;
  operationType?: AuditOperationType | '';
}

export interface DeleteAuditLogsResponse {
  data: { deletedCount: number };
}

// --- Settings types ---

export interface ConsensusSettings {
  partialAggregationEnabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ConsensusSettingsResponse {
  data: ConsensusSettings;
}

export type RankingDisplayScope = 'ALL_USERS' | 'TEAM_ONLY' | 'TOP_N';

export interface RankingSettings {
  displayScope: RankingDisplayScope;
  topN?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface RankingSettingsResponse {
  data: RankingSettings;
}

export interface UpdateRankingSettingsRequest {
  displayScope: RankingDisplayScope;
  topN?: number;
}

// --- Sync user types ---

export interface SyncUserRequest {
  email: string;
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  displayName?: string;
}

// --- Service class ---

export class AdminApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  // === User Management ===

  /**
   * ユーザー一覧を取得する
   */
  async getUsers(): Promise<Result<UsersResponse, AppError>> {
    return this.client.get<UsersResponse>('/admin/users');
  }

  /**
   * ユーザーを作成する
   */
  async createUser(data: CreateUserRequest): Promise<Result<UserResponse, AppError>> {
    return this.client.post<UserResponse>('/admin/users', data);
  }

  /**
   * ユーザーを更新する（ロール変更・無効化）
   */
  async updateUser(userId: string, data: UpdateUserRequest): Promise<Result<UserResponse, AppError>> {
    return this.client.patch<UserResponse>(`/admin/users/${userId}`, data);
  }

  /**
   * Cognitoに既存のユーザーをアプリに同期登録する（Cognito読み取りのみ）
   */
  async syncUser(data: SyncUserRequest): Promise<Result<UserResponse, AppError>> {
    return this.client.post<UserResponse>('/admin/users/sync', data);
  }

  // === Team Management ===

  /**
   * チーム一覧を取得する
   */
  async getTeams(): Promise<Result<TeamsResponse, AppError>> {
    return this.client.get<TeamsResponse>('/admin/teams');
  }

  /**
   * チームを作成する
   */
  async createTeam(data: CreateTeamRequest): Promise<Result<TeamResponse, AppError>> {
    return this.client.post<TeamResponse>('/admin/teams', data);
  }

  /**
   * チームを更新する
   */
  async updateTeam(teamId: string, data: UpdateTeamRequest): Promise<Result<TeamResponse, AppError>> {
    return this.client.patch<TeamResponse>(`/admin/teams/${teamId}`, data);
  }

  /**
   * チームを削除する
   */
  async deleteTeam(teamId: string): Promise<Result<{ data: { deleted: true } }, AppError>> {
    return this.client.delete<{ data: { deleted: true } }>(`/admin/teams/${teamId}`);
  }

  /**
   * チームメンバー一覧を取得する
   */
  async getTeamMembers(teamId: string): Promise<Result<TeamMembersResponse, AppError>> {
    return this.client.get<TeamMembersResponse>(`/admin/teams/${teamId}/members`);
  }

  /**
   * チームにメンバーを追加する
   */
  async addTeamMember(teamId: string, userId: string): Promise<Result<TeamMembershipResponse, AppError>> {
    return this.client.post<TeamMembershipResponse>(`/admin/teams/${teamId}/members`, { userId });
  }

  /**
   * チームからメンバーを削除する
   */
  async removeTeamMember(teamId: string, userId: string): Promise<Result<{ data: { deleted: true } }, AppError>> {
    return this.client.delete<{ data: { deleted: true } }>(`/admin/teams/${teamId}/members/${userId}`);
  }

  // === Team Assignments ===

  /**
   * チームの割り当て済みセッション一覧を取得する
   * GET /admin/teams/{teamId}/assignments
   * バックエンドの createdBy/createdAt を assignedBy/assignedAt にマッピングする。
   */
  async getTeamAssignments(teamId: string): Promise<Result<TeamAssignmentsResponse, AppError>> {
    const result = await this.client.get<{ data: RawTeamAssignment[] }>(`/admin/teams/${teamId}/assignments`);
    if (!result.ok) return result;
    return { ok: true, value: { data: result.value.data.map(mapAssignment) } };
  }

  /**
   * セッションをチームに割り当てる
   * POST /admin/teams/{teamId}/assignments（201, 単一 Record）
   */
  async assignSession(teamId: string, sessionId: string): Promise<Result<{ data: TeamAssignment }, AppError>> {
    const result = await this.client.post<{ data: RawTeamAssignment }>(`/admin/teams/${teamId}/assignments`, { sessionId });
    if (!result.ok) return result;
    return { ok: true, value: { data: mapAssignment(result.value.data) } };
  }

  /**
   * セッションのチーム割り当てを解除する
   * DELETE /admin/teams/{teamId}/assignments/{sessionId}
   */
  async unassignSession(teamId: string, sessionId: string): Promise<Result<{ data: { deleted: true } }, AppError>> {
    return this.client.delete<{ data: { deleted: true } }>(`/admin/teams/${teamId}/assignments/${sessionId}`);
  }

  // === IP Allowlist ===

  /**
   * IPアドレス許可リストを取得する
   */
  async getIPAllowlist(): Promise<Result<IPAllowlistResponse, AppError>> {
    return this.client.get<IPAllowlistResponse>('/admin/ip-allowlist');
  }

  /**
   * IPアドレスエントリを追加する
   */
  async addIPEntry(data: AddIPEntryRequest): Promise<Result<AddIPEntryResponse, AppError>> {
    return this.client.post<AddIPEntryResponse>('/admin/ip-allowlist', data);
  }

  /**
   * IPアドレスエントリを削除する
   */
  async deleteIPEntry(entryId: string): Promise<Result<DeleteIPEntryResponse, AppError>> {
    return this.client.delete<DeleteIPEntryResponse>(`/admin/ip-allowlist/${entryId}`);
  }

  // === Audit Logs ===

  /**
   * 監査ログを検索する（フィルタ・ページネーション付き）
   */
  async searchAuditLogs(params: AuditLogSearchParams): Promise<Result<AuditLogSearchResponse, AppError>> {
    const queryParts: string[] = [];

    if (params.startDate) {
      queryParts.push(`startDate=${encodeURIComponent(params.startDate)}`);
    }
    if (params.endDate) {
      queryParts.push(`endDate=${encodeURIComponent(params.endDate)}`);
    }
    if (params.actorUserId) {
      queryParts.push(`actorUserId=${encodeURIComponent(params.actorUserId)}`);
    }
    if (params.operationType) {
      queryParts.push(`operationType=${encodeURIComponent(params.operationType)}`);
    }
    if (params.page && params.page > 1) {
      queryParts.push(`page=${params.page}`);
    }

    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return this.client.get<AuditLogSearchResponse>(`/admin/audit-logs${queryString}`);
  }

  /**
   * 監査ログを削除する（フィルタ条件に一致するエントリ）
   */
  async deleteAuditLogs(filters: DeleteAuditLogsRequest): Promise<Result<DeleteAuditLogsResponse, AppError>> {
    const body: Record<string, string> = {};
    if (filters.startDate) body.startDate = filters.startDate;
    if (filters.endDate) body.endDate = filters.endDate;
    if (filters.actorUserId) body.actorUserId = filters.actorUserId;
    if (filters.operationType) body.operationType = filters.operationType;

    return this.client.post<DeleteAuditLogsResponse>('/admin/audit-logs/delete', body);
  }

  // === Settings ===

  /**
   * Consensus設定を更新する
   */
  async updateConsensusSettings(data: { partialAggregationEnabled: boolean }): Promise<Result<ConsensusSettingsResponse, AppError>> {
    return this.client.patch<ConsensusSettingsResponse>('/admin/settings/consensus', data);
  }

  /**
   * ランキング設定を取得する
   */
  async getRankingSettings(): Promise<Result<RankingSettingsResponse, AppError>> {
    return this.client.get<RankingSettingsResponse>('/admin/settings/ranking');
  }

  /**
   * ランキング設定を更新する
   */
  async updateRankingSettings(data: UpdateRankingSettingsRequest): Promise<Result<RankingSettingsResponse, AppError>> {
    return this.client.patch<RankingSettingsResponse>('/admin/settings/ranking', data);
  }
}
