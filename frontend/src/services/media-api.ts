import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';

/**
 * MediaApi - メディアファイル関連 API クライアント
 *
 * - POST /upload-url: PresignedURL 生成
 * - GET /media-files: メディアファイル一覧取得
 *
 * Requirements: 2.1
 */

// --- Request / Response types ---

export interface UploadUrlRequest {
  filename: string;
  contentType: string;
  fileSize: number;
}

export interface UploadUrlResponse {
  presignedUrl: string;
  mediaFileId: string;
  s3Key: string;
  expiresAt: string;
}

export type MediaFileStatus = 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface MediaFile {
  mediaFileId: string;
  filename: string;
  s3Key: string;
  contentType: string;
  fileSize: number;
  uploadedBy: string;
  /** アップロードユーザーの表示名（バックエンドで解決。未解決時は uploadedBy を返す） */
  uploadedByName?: string;
  teamId?: string;
  status: MediaFileStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFileListResponse {
  data: {
    mediaFiles: MediaFile[];
  };
}

// --- Service class ---

export class MediaApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * PresignedURL を生成してメディアファイルのアップロードを開始する
   */
  async getUploadUrl(params: UploadUrlRequest): Promise<Result<UploadUrlResponse, AppError>> {
    return this.client.post<UploadUrlResponse>('/upload-url', params);
  }

  /**
   * メディアファイル一覧を取得する
   */
  async listMediaFiles(): Promise<Result<MediaFileListResponse, AppError>> {
    return this.client.get<MediaFileListResponse>('/media-files');
  }

  /**
   * PresignedURL を使用してファイルを S3 に直接アップロードする
   */
  async uploadFileToS3(
    presignedUrl: string,
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<Result<void, AppError>> {
    try {
      const xhr = new XMLHttpRequest();

      const result = await new Promise<Result<void, AppError>>((resolve) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ ok: true, value: undefined });
          } else {
            resolve({
              ok: false,
              error: {
                code: 'UPLOAD_FAILED',
                message: `アップロードに失敗しました (${xhr.status})`,
                statusCode: xhr.status,
              },
            });
          }
        });

        xhr.addEventListener('error', () => {
          resolve({
            ok: false,
            error: {
              code: 'NETWORK_ERROR',
              message: 'ネットワークエラーが発生しました。接続を確認してください。',
            },
          });
        });

        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      return result;
    } catch {
      return {
        ok: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: 'アップロード処理中にエラーが発生しました。',
        },
      };
    }
  }
}
