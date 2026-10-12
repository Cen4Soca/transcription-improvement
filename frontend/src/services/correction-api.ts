import type { Result, AppError } from '../types/api';
import type { Correction, CorrectionType } from '../types/correction';
import type { ApiClient } from './api-client';

/**
 * CorrectionApi - Correction 保存・復元 API クライアント
 *
 * - POST /sessions/{sessionId}/corrections: Correction 保存（冪等）
 * - GET /sessions/{sessionId}/corrections: 自分の Correction 一覧取得（復元用）
 *
 * Requirements: 2.3, 2.10, 2.15, 3.1, 3.3, 3.5
 */

export interface CreateCorrectionInput {
  correctionId: string;
  segmentId: string;
  correctionType: CorrectionType;
  beforeText: string;
  afterText: string;
  beforeSpeaker?: string;
  afterSpeaker?: string;
  affectedSegmentCount?: number;
}

export interface CorrectionsListResponse {
  data: Correction[];
}

export class CorrectionApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Correction を保存する
   * correctionId を冪等キーとして扱う（重複時はサーバーが 200 を返す）
   * Requirements: 2.3, 3.1
   */
  async createCorrection(
    sessionId: string,
    input: CreateCorrectionInput
  ): Promise<Result<Correction, AppError>> {
    return this.client.post<Correction>(
      `/sessions/${sessionId}/corrections`,
      input
    );
  }

  /**
   * セッション内の自分の Correction 一覧を取得する（作成時刻の昇順）
   * ReviewSession を再度開いた際の修正復元に使用する
   * Requirements: 3.3
   */
  async listCorrections(
    sessionId: string
  ): Promise<Result<CorrectionsListResponse, AppError>> {
    return this.client.get<CorrectionsListResponse>(
      `/sessions/${sessionId}/corrections`
    );
  }
}
