/**
 * ContributorScore - コントリビュータースコア
 * Userの回答数と正答率を掛け合わせて算出した総合スコア
 */
export interface ContributorScore {
  userId: string;
  displayName: string;
  period: RankingPeriod;
  answerCount: number;
  accuracyRate: number;
  score: number;
  rank: number;
  updatedAt: string;
}

export type RankingPeriod =
  | 'ALL'
  | 'THIS_MONTH'
  | 'THIS_YEAR'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS';

/**
 * RankingSettings - ランキング表示範囲設定（Admin設定）
 */
export interface RankingSettings {
  displayScope: RankingDisplayScope;
  topN?: number;
  updatedAt: string;
  updatedBy: string;
}

export type RankingDisplayScope = 'ALL_USERS' | 'TEAM_ONLY' | 'TOP_N';
