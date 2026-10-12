import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';

/**
 * LanguageModelApi - カスタム言語モデル関連 API クライアント
 *
 * - GET /language-models: モデル一覧取得
 * - POST /language-models: モデル作成
 * - GET /language-models/{modelName}: モデルステータス取得
 *
 * Requirements: 6.4
 */

// --- Request / Response types ---

export interface CreateLanguageModelRequest {
  modelName: string;
  baseModelName: 'NarrowBand' | 'WideBand';
  sessionIds: string[];
}

export interface LanguageModelRecord {
  modelName: string;
  baseModelName: string;
  status: string;
  trainingDataS3Uri: string;
  createdBy: string;
  createdAt: string;
}

export interface LanguageModelSummary {
  modelName: string;
  modelStatus: string;
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

// --- Service class ---

export class LanguageModelApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * 利用可能なカスタム言語モデル一覧を取得する（COMPLETED のみ）
   */
  async listModels(): Promise<Result<LanguageModelListResponse, AppError>> {
    return this.client.get<LanguageModelListResponse>('/language-models');
  }

  /**
   * カスタム言語モデルを作成する（Admin/TeamLeader のみ）
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
}
