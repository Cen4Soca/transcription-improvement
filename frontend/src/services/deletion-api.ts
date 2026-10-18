import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';

/**
 * DeletionApi - メディアファイル・Transcription 削除関連 API クライアント
 *
 * - DELETE /media-files/{mediaFileId}: メディアファイル削除
 * - DELETE /sessions/{sessionId}/transcription: Transcription 削除
 *
 * Requirements: 7.4
 */

// --- Response types ---

export interface DeleteResponse {
  message: string;
}

// --- Service class ---

export class DeletionApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * メディアファイルを削除する
   * S3 オブジェクトと DynamoDB メタデータを削除する。
   * アクセス制御はバックエンドで実施（ADMIN=全て / TEAM_LEADER=チームメンバー分 / REVIEWER=自分の分）。
   *
   * 進行中の校閲セッションに紐づくメディアの場合:
   * - REVIEWER: 403 で拒否される
   * - ADMIN / TEAM_LEADER: force=false だと 409（確認要求）。force=true で削除実行。
   */
  async deleteMediaFile(
    mediaFileId: string,
    options?: { force?: boolean }
  ): Promise<Result<DeleteResponse, AppError>> {
    const query = options?.force ? '?force=true' : '';
    return this.client.delete<DeleteResponse>(`/media-files/${mediaFileId}${query}`);
  }

  /**
   * Transcription を削除する（Admin/TeamLeader のみ）
   * S3 出力ファイルと DynamoDB の関連レコード（Session, Segment, Correction, ConsensusResult）をカスケード削除する
   */
  async deleteTranscription(sessionId: string): Promise<Result<DeleteResponse, AppError>> {
    return this.client.delete<DeleteResponse>(`/sessions/${sessionId}/transcription`);
  }
}
