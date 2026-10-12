import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';
import type { ConsensusSegment } from '../types/consensus';

/**
 * ConsensusApi - Consensus 関連 API クライアント（ADMIN 専用）
 *
 * - GET /consensus/{sessionId}/segments: Consensus 状態と各 Reviewer 回答を取得
 * - POST /consensus/{sessionId}/resolve: CONFLICT セグメントを手動解決
 *
 * Requirements: 2.1, 2.2
 */

export interface ConsensusSegmentsResponse {
  data: ConsensusSegment[];
}

export interface ResolveConsensusResponse {
  data: {
    sessionId: string;
    segmentId: string;
    consensusText: string;
    confirmedBy: string;
    confirmedAt: string;
  };
}

export class ConsensusApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Consensus 状態と各 Reviewer 回答を取得する（ADMIN 専用）
   * GET /consensus/{sessionId}/segments
   */
  async getConsensusSegments(
    sessionId: string
  ): Promise<Result<ConsensusSegmentsResponse, AppError>> {
    return this.client.get<ConsensusSegmentsResponse>(
      `/consensus/${sessionId}/segments`
    );
  }

  /**
   * CONFLICT セグメントを手動解決する（ADMIN 専用）
   * POST /consensus/{sessionId}/resolve
   */
  async resolveConsensus(
    sessionId: string,
    input: { segmentId: string; selectedText: string }
  ): Promise<Result<ResolveConsensusResponse, AppError>> {
    return this.client.post<ResolveConsensusResponse>(
      `/consensus/${sessionId}/resolve`,
      input
    );
  }
}
