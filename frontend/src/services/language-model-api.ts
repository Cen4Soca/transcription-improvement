import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';
import type { Team } from '../types/team';

/**
 * LanguageModelApi - カスタム言語モデル関連 API クライアント
 *
 * - GET /language-models: モデル一覧取得（チームスコープ・displayName 表示）
 * - POST /language-models: モデル作成（teamId / displayName 必須）
 * - GET /language-models/{modelName}: モデルステータス取得
 * - PATCH /language-models/{modelName}/name: 表示名編集
 * - PATCH /language-models/{modelName}/team: teamId 付け替え（ADMIN のみ）
 * - DELETE /language-models/{modelName}: モデル削除
 * - GET /me/teams: 作成フォームのチーム選択肢（ADMIN=全チーム / その他=自チーム）
 *
 * Requirements: 18, 20, 削除 / teamId 編集 / 表示名編集
 */

// --- Request / Response types ---

export interface CreateLanguageModelRequest {
  modelName: string;
  baseModelName: 'NarrowBand' | 'WideBand';
  teamId: string;
  displayName: string;
  sessionIds: string[];
}

export interface LanguageModelRecord {
  modelName: string;
  baseModelName: string;
  displayName?: string;
  teamId?: string;
  status: string;
  trainingDataS3Uri: string;
  createdBy: string;
  createdAt: string;
}

export interface LanguageModelSummary {
  modelName: string;
  modelStatus: string;
  displayName?: string;
  teamId?: string;
  baseModelName?: string;
  createTime?: string;
}

export interface LanguageModelListResponse {
  models: LanguageModelSummary[];
}

export interface LanguageModelStatus {
  modelName: string;
  modelStatus: string;
  baseModelName?: string;
  failureReason?: string;
}

/**
 * TeamAssignmentRecord - 指定チームの TeamAssignment レコード
 *
 * バックエンド `team-repository.ts` の形状（`{ teamId, sessionId, createdBy, createdAt }`）に合わせた
 * フロント側のローカル定義。候補セッション絞り込みに使用する。
 */
export interface TeamAssignmentRecord {
  teamId: string;
  sessionId: string;
  createdBy: string;
  createdAt: string;
}

/** Metadata returned by the name / team edit endpoints. */
export interface LanguageModelMetadata {
  modelName: string;
  teamId: string;
  displayName: string;
  displayNameLower?: string;
  baseModelName?: string;
  createdBy?: string;
  createdAt?: string;
  sessionIds?: string[];
  s3Key?: string;
  deletionStatus?: 'ACTIVE' | 'PENDING';
}

// --- Service class ---

export class LanguageModelApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * 利用可能なカスタム言語モデル一覧を取得する（チームスコープ・COMPLETED のみ）
   */
  async listModels(): Promise<Result<LanguageModelListResponse, AppError>> {
    return this.client.get<LanguageModelListResponse>('/language-models');
  }

  /**
   * カスタム言語モデルを作成する（Admin/TeamLeader のみ、teamId / displayName 必須）
   */
  async createModel(params: CreateLanguageModelRequest): Promise<Result<LanguageModelRecord, AppError>> {
    return this.client.post<LanguageModelRecord>('/language-models', params);
  }

  /**
   * カスタム言語モデルのステータスを取得する（Admin/TeamLeader のみ）
   */
  async getModelStatus(modelName: string): Promise<Result<LanguageModelStatus, AppError>> {
    return this.client.get<LanguageModelStatus>(`/language-models/${encodeURIComponent(modelName)}`);
  }

  /**
   * カスタム言語モデルを削除する（Admin / 自チームの TeamLeader）
   */
  async deleteModel(modelName: string): Promise<Result<{ data: { deleted: true } }, AppError>> {
    return this.client.delete<{ data: { deleted: true } }>(
      `/language-models/${encodeURIComponent(modelName)}`
    );
  }

  /**
   * カスタム言語モデルの表示名を更新する（Admin / 自チームの TeamLeader）
   */
  async updateModelName(
    modelName: string,
    name: string
  ): Promise<Result<{ data: LanguageModelMetadata }, AppError>> {
    return this.client.patch<{ data: LanguageModelMetadata }>(
      `/language-models/${encodeURIComponent(modelName)}/name`,
      { name }
    );
  }

  /**
   * カスタム言語モデルの所属チームを変更する（Admin のみ）
   */
  async updateModelTeam(
    modelName: string,
    teamId: string
  ): Promise<Result<{ data: LanguageModelMetadata }, AppError>> {
    return this.client.patch<{ data: LanguageModelMetadata }>(
      `/language-models/${encodeURIComponent(modelName)}/team`,
      { teamId }
    );
  }

  /**
   * 作成フォームのチーム選択肢を取得する
   * （ADMIN は全チーム、TEAM_LEADER は自身の所属チームのみ）
   */
  async getMyTeams(): Promise<Result<{ data: Team[] }, AppError>> {
    return this.client.get<{ data: Team[] }>('/me/teams');
  }

  /**
   * 指定チームの TeamAssignment 一覧を取得する（候補絞り込み用）
   * （ADMIN は任意チーム、TEAM_LEADER は自チームのみ。バックエンドで認可）
   */
  async listTeamAssignments(
    teamId: string
  ): Promise<Result<{ data: TeamAssignmentRecord[] }, AppError>> {
    return this.client.get<{ data: TeamAssignmentRecord[] }>(
      `/admin/teams/${encodeURIComponent(teamId)}/assignments`
    );
  }
}
