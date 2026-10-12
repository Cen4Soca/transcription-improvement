/**
 * ReviewSession - 校閲セッション
 * 一つのTranscriptionJobに対するReviewの作業単位
 */
export interface ReviewSession {
  sessionId: string;
  transcriptionJobId: string;
  name: string;
  status: ReviewSessionStatus;
  /** このセッションを引き受けた/割り当てられたレビュアーの userId */
  assignedUserId?: string;
  /** このセッションが割り当てられたチームの teamId（レビュアーが引き受け可能） */
  assignedTeamId?: string;
  assignedReviewerCount: number;
  consensusThreshold: number;
  partialAggregationEnabled: boolean;
  /** 紐づくメディアファイルが削除済みの場合 true */
  mediaFileDeleted?: boolean;
  /**
   * 話者ラベルのマスタ一覧。
   * 校閲画面に表示するラベルは、このマスタと各 Segment.speakerLabel 由来のラベルの和集合。
   * どの Segment にも割り当てられていないラベルを保持するために使う。
   */
  speakerLabels?: string[];
  createdAt: string;
  updatedAt: string;
}

export type ReviewSessionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * ForceAggregateResult - 強制集約（POST /sessions/{sessionId}/aggregate）の結果
 * ADMIN / TEAM_LEADER が最低レビュアー数を満たす前にセッションを確定・完了させたときのサマリ。
 */
export interface ForceAggregateResult {
  sessionId: string;
  status: ReviewSessionStatus;
  totalReviewers: number;
  confirmedCount: number;
  conflictCount: number;
}

/**
 * ReopenSessionResult - 差し戻し（POST /sessions/{sessionId}/reopen）の結果
 * ADMIN / TEAM_LEADER が完了済みセッションを進行中に戻したときの結果。
 */
export interface ReopenSessionResult {
  sessionId: string;
  status: ReviewSessionStatus;
}
