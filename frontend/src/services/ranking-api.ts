import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';
import type { RankingPeriod } from '../types/ranking';

/**
 * RankingApi - ランキング関連 API クライアント
 *
 * - GET /ranking: ランキング取得
 *
 * Requirements: 12.1
 */

export interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  answerCount: number;
  accuracyRate: number;
  score: number;
}

export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface RankingResponse {
  data: {
    rankings: RankingEntry[];
    currentUser: RankingEntry | null;
    pagination: PaginationInfo;
  };
}

export class RankingApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * ランキングを取得する
   */
  async getRanking(options?: {
    period?: RankingPeriod;
    page?: number;
  }): Promise<Result<RankingResponse, AppError>> {
    const params = new URLSearchParams();
    if (options?.period) params.set('period', options.period);
    if (options?.page) params.set('page', String(options.page));
    const query = params.toString();
    return this.client.get<RankingResponse>(`/ranking${query ? `?${query}` : ''}`);
  }
}
