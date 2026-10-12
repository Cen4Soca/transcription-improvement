import type { Result, AppError } from '../types/api';
import type {
  ReviewSession,
  ForceAggregateResult,
  ReopenSessionResult,
} from '../types/session';
import type { Segment } from '../types/segment';
import type { ApiClient } from './api-client';

/**
 * SessionApi - ReviewSession 管理 API クライアント
 *
 * - GET /sessions: セッション一覧取得
 * - GET /sessions/{sessionId}: セッション詳細取得
 * - GET /sessions/{sessionId}/segments: セグメント一覧取得
 * - PATCH /sessions/{sessionId}/status: セッション状態更新（完了マーク）
 *
 * Requirements: 3.1, 3.6
 */

export interface SessionListResponse {
  items: ReviewSession[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface SessionDetailResponse {
  data: {
    session: ReviewSession;
    mediaFile: {
      mediaFileId: string;
      filename: string;
      contentType: string;
      fileSize: number;
      status: string;
      scanStatus?: string;
    } | null;
  };
}

export interface SegmentsResponse {
  data: {
    segments: Segment[];
  };
}

export class SessionApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * セッション一覧を取得する
   */
  async listSessions(options?: {
    status?: string;
    page?: number;
  }): Promise<Result<SessionListResponse, AppError>> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.page) params.set('page', String(options.page));
    const query = params.toString();
    return this.client.get<SessionListResponse>(`/sessions${query ? `?${query}` : ''}`);
  }

  /**
   * セッション詳細を取得する
   */
  async getSessionDetail(sessionId: string): Promise<Result<SessionDetailResponse, AppError>> {
    return this.client.get<SessionDetailResponse>(`/sessions/${sessionId}`);
  }

  /**
   * セッションのセグメント一覧を取得する
   */
  async getSegments(sessionId: string): Promise<Result<SegmentsResponse, AppError>> {
    return this.client.get<SegmentsResponse>(`/sessions/${sessionId}/segments`);
  }

  /**
   * セッションのメディアURL（署名付き）を取得する
   */
  async getMediaUrl(sessionId: string): Promise<Result<{ data: { url: string; expiresAt: string } }, AppError>> {
    return this.client.get<{ data: { url: string; expiresAt: string } }>(`/sessions/${sessionId}/media-url`);
  }

  /**
   * ReviewSession を完了としてマークする
   * Requirements: 3.6
   */
  async markSessionComplete(
    sessionId: string
  ): Promise<Result<{ data: ReviewSession }, AppError>> {
    return this.client.patch<{ data: ReviewSession }>(
      `/sessions/${sessionId}/status`,
      { status: 'COMPLETED' }
    );
  }

  /**
   * 自分に割り当てられたセッション一覧を取得する
   * GET /sessions/assigned
   */
  async listAssignedSessions(): Promise<
    Result<AssignedSessionsResponse, AppError>
  > {
    return this.client.get<AssignedSessionsResponse>('/sessions/assigned');
  }

  /**
   * セッションをユーザーまたはチームに割り当てる（Admin / TeamLeader）
   * PATCH /sessions/{sessionId}/assignment
   */
  async assignSession(
    sessionId: string,
    input: { assignedUserId?: string; assignedTeamId?: string }
  ): Promise<Result<{ data: ReviewSession }, AppError>> {
    return this.client.patch<{ data: ReviewSession }>(
      `/sessions/${sessionId}/assignment`,
      input
    );
  }

  /**
   * 自チームに割り当てられたセッションを引き受ける（Reviewer）
   * POST /sessions/{sessionId}/join
   */
  async claimSession(
    sessionId: string
  ): Promise<Result<{ data: ReviewSession }, AppError>> {
    return this.client.post<{ data: ReviewSession }>(
      `/sessions/${sessionId}/join`,
      {}
    );
  }

  /**
   * 自分が参加可能なセッション候補一覧を取得する（Reviewer）
   * GET /sessions/joinable
   * サーバー側で「自チームに割り当て済み・PENDING・自分が未参加」をフィルタ済み。
   */
  async listJoinableSessions(): Promise<
    Result<JoinableSessionsResponse, AppError>
  > {
    return this.client.get<JoinableSessionsResponse>('/sessions/joinable');
  }

  /**
   * 自チームに割り当てられた PENDING セッションに自分で参加する（Reviewer）
   * POST /sessions/{sessionId}/self-assign
   */
  async selfAssignSession(
    sessionId: string
  ): Promise<Result<{ data: ReviewSession }, AppError>> {
    return this.client.post<{ data: ReviewSession }>(
      `/sessions/${sessionId}/self-assign`,
      {}
    );
  }

  /**
   * セッション名を変更する
   * PATCH /sessions/{sessionId}/name
   * サーバー側で前後の空白をトリムし、トリム後 1〜100 文字に制約する。
   */
  async renameSession(
    sessionId: string,
    name: string
  ): Promise<Result<{ data: ReviewSession }, AppError>> {
    return this.client.patch<{ data: ReviewSession }>(
      `/sessions/${sessionId}/name`,
      { name }
    );
  }

  /**
   * 話者ラベルをセッションのマスタ一覧に追加する
   * POST /sessions/{sessionId}/speaker-labels
   * サーバー側で前後の空白をトリムし、空・重複を拒否する。
   */
  async addSpeakerLabel(
    sessionId: string,
    label: string
  ): Promise<Result<{ data: ReviewSession }, AppError>> {
    return this.client.post<{ data: ReviewSession }>(
      `/sessions/${sessionId}/speaker-labels`,
      { label }
    );
  }

  /**
   * 話者ラベルをセッションのマスタ一覧から削除する
   * DELETE /sessions/{sessionId}/speaker-labels/{label}
   * サーバー側でそのセッションのいずれの Segment にも使われていないことを確認してから削除する。
   */
  async deleteSpeakerLabel(
    sessionId: string,
    label: string
  ): Promise<Result<{ data: ReviewSession }, AppError>> {
    return this.client.delete<{ data: ReviewSession }>(
      `/sessions/${sessionId}/speaker-labels/${encodeURIComponent(label)}`
    );
  }

  /**
   * トランスクリプションからセッション名の候補を取得する
   * GET /sessions/{sessionId}/name-suggestion
   * suggestion は 100 文字以内または null。hasExternalApiError が true の場合は
   * Bedrock 呼び出しに失敗している（suggestion は null）。
   */
  async getSessionNameSuggestion(
    sessionId: string
  ): Promise<Result<{ suggestion: string | null; hasExternalApiError: boolean }, AppError>> {
    return this.client.get<{ suggestion: string | null; hasExternalApiError: boolean }>(
      `/sessions/${sessionId}/name-suggestion`
    );
  }

  /**
   * セッションを強制的に集約して完了としてマークする（ADMIN / TEAM_LEADER）
   * POST /sessions/{sessionId}/aggregate
   * 自動集約の最低レビュアー数（既定 3 名）に満たない場合でも手動でセッションを確定できる。
   * ADMIN は全セッション、TEAM_LEADER は自チームのセッションのみ。既に COMPLETED の場合は 400。
   */
  async forceAggregateSession(
    sessionId: string
  ): Promise<Result<{ data: ForceAggregateResult }, AppError>> {
    return this.client.post<{ data: ForceAggregateResult }>(
      `/sessions/${sessionId}/aggregate`,
      {}
    );
  }

  /**
   * 完了済みセッションを進行中に戻す（ADMIN / TEAM_LEADER）
   * POST /sessions/{sessionId}/reopen
   * 完了したトランスクリプションの品質が悪いときに、ADMIN / TEAM_LEADER が
   * セッションを再び進行中へ差し戻す。確定済みの結果は保持される（ポリシー A）。
   * ADMIN は全セッション、TEAM_LEADER は自チームのセッションのみ。
   */
  async reopenSession(
    sessionId: string
  ): Promise<Result<{ data: ReopenSessionResult }, AppError>> {
    return this.client.post<{ data: ReopenSessionResult }>(
      `/sessions/${sessionId}/reopen`,
      {}
    );
  }
}

export interface AssignedSessionsResponse {
  data: {
    items: ReviewSession[];
  };
}

export interface JoinableSessionsResponse {
  data: {
    items: ReviewSession[];
  };
}
