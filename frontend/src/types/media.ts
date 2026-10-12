/**
 * MediaFile - S3に保存された音声・動画ファイル
 * マルウェアスキャン対応
 */
export interface MediaFile {
  mediaFileId: string;
  sessionId: string;
  filename: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
  scanStatus: ScanStatus;
  scanCompletedAt?: string;
}

export type ScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';

/**
 * TranscriptionJob - Amazon Transcribeが実行した文字起こし処理の単位
 */
export interface TranscriptionJob {
  jobId: string;
  mediaFileId: string;
  sessionId: string;
  status: TranscriptionJobStatus;
  languageCode: string;
  maxSpeakerLabels: number;
  languageModelName?: string;
  createdAt: string;
  completedAt?: string;
}

export type TranscriptionJobStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
