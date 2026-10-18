/**
 * Segment - 文字起こしの最小単位
 * 開始時刻・終了時刻・テキスト・話者情報を持つ
 */
export interface Segment {
  segmentId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel?: string;
  consensusStatus: ConsensusStatus;
  consensusText?: string;
}

export type ConsensusStatus = 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT';

/**
 * ConsensusResult - 合意結果
 * 複数ReviewerのCorrectionを集計し、ConsensusThresholdを超えた回答として確定したテキスト
 */
export interface ConsensusResult {
  sessionId: string;
  segmentId: string;
  consensusText: string;
  confirmedAt: string;
  confirmedBy: 'AUTO' | string;
  totalReviewers: number;
  agreementCount: number;
  agreementRate: number;
}
