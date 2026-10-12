/**
 * Correction - Reviewerが加えた文字起こしテキストまたは話者情報への変更内容
 */
export interface Correction {
  correctionId: string;
  sessionId: string;
  segmentId: string;
  userId: string;
  correctionType: CorrectionType;
  beforeText: string;
  afterText: string;
  beforeSpeaker?: string;
  afterSpeaker?: string;
  affectedSegmentCount?: number;
  createdAt: string;
}

export type CorrectionType = 'TEXT' | 'SPEAKER' | 'SPEAKER_RENAME';
