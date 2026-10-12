import type { Result, AppError } from '../types/api';
import type { ApiClient } from './api-client';

/**
 * SuggestionApi - 修正候補取得 API クライアント
 *
 * - GET /sessions/{sessionId}/suggestions?segmentId=xxx&text=yyy
 *   CorrectionHistory + Bedrock(Claude) + Comprehend から候補を生成する
 *
 * Requirements: 8.1, 8.2, 8.3, 8.7
 */

export type SuggestionSource = 'history' | 'bedrock' | 'comprehend';

export interface SuggestionCandidate {
  text: string;
  source: SuggestionSource;
}

export interface SuggestionResponse {
  suggestions: SuggestionCandidate[];
  hasExternalApiError: boolean;
}

export class SuggestionApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * 指定 Segment に対する修正候補を取得する（最大5件）
   * Requirements: 8.1, 8.2, 8.3, 8.7
   */
  async getSuggestions(
    sessionId: string,
    segmentId: string,
    originalText: string
  ): Promise<Result<SuggestionResponse, AppError>> {
    const params = new URLSearchParams();
    params.set('segmentId', segmentId);
    params.set('text', originalText);
    return this.client.get<SuggestionResponse>(
      `/sessions/${sessionId}/suggestions?${params.toString()}`
    );
  }
}
