import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';

/**
 * TranscriptionApi - Transcription ジョブ・ダウンロード関連 API クライアント
 *
 * - POST /transcription-jobs: ジョブ開始
 * - GET /transcription-jobs/{jobId}: ジョブステータス取得
 * - GET /sessions/{sessionId}/download: 修正後 Transcription ダウンロード
 *
 * Requirements: 3.1, 5.8
 */

// --- Request / Response types ---

export interface StartTranscriptionJobRequest {
  mediaFileId: string;
  maxSpeakerLabels?: number;
  languageCode?: string;
  languageModelName?: string;
}

export type TranscriptionJobStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface TranscriptionJob {
  jobId: string;
  transcribeJobName: string;
  mediaFileId: string;
  status: TranscriptionJobStatus;
  languageCode: string;
  maxSpeakerLabels: number;
  languageModelName?: string;
  outputS3Key?: string;
  sessionId?: string;
  failureReason?: string;
  startedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type DownloadFormat = 'json' | 'srt';

export interface TranscriptionDownloadSegment {
  startTime: number;
  endTime: number;
  text: string;
  speakerLabel?: string;
}

export interface TranscriptionJsonResponse {
  sessionName: string;
  exportedAt: string;
  segments: TranscriptionDownloadSegment[];
}

// --- Service class ---

export class TranscriptionApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Transcription ジョブを開始する
   */
  async startJob(params: StartTranscriptionJobRequest): Promise<Result<TranscriptionJob, AppError>> {
    return this.client.post<TranscriptionJob>('/transcription-jobs', params);
  }

  /**
   * Transcription ジョブのステータスを取得する
   */
  async getJobStatus(jobId: string): Promise<Result<TranscriptionJob, AppError>> {
    return this.client.get<TranscriptionJob>(`/transcription-jobs/${jobId}`);
  }

  /**
   * 修正後 Transcription をダウンロードする（JSON 形式）
   */
  async downloadJson(sessionId: string): Promise<Result<TranscriptionJsonResponse, AppError>> {
    return this.client.get<TranscriptionJsonResponse>(
      `/sessions/${sessionId}/download?format=json`,
    );
  }

  /**
   * 修正後 Transcription をダウンロードする（SRT 形式）
   * SRT はテキスト形式のため、Blob としてダウンロードを処理する
   */
  async downloadSrt(sessionId: string): Promise<Result<string, AppError>> {
    return this.client.get<string>(`/sessions/${sessionId}/download?format=srt`);
  }
}
