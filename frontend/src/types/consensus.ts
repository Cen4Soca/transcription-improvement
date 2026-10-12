/**
 * Consensus フロント型
 *
 * バックエンド `get-consensus.ts` の `ConsensusSegment`/`ReviewerAnswer` に一致させる。
 * フロントはバックエンドと型を共有しない方針のため複製する。
 */

export type ConsensusStatus = 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT';

export interface ReviewerAnswer {
  text: string;
  count: number;
  userIds: string[];
}

export interface ConsensusSegment {
  segmentId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel?: string;
  consensusStatus: ConsensusStatus;
  consensusText?: string;
  reviewerAnswers?: ReviewerAnswer[];
}
