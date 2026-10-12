import { useState, useCallback, useRef, useEffect } from 'react';
import type { MediaApi, UploadUrlResponse, MediaFile } from '../services/media-api';
import type { AppError } from '../types/api';

export type UploadPhase = 'idle' | 'validating' | 'requesting-url' | 'uploading' | 'completed' | 'error';

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  mediaFileId: string | null;
  error: AppError | null;
}

export interface UseMediaUploadReturn {
  uploadState: UploadState;
  upload: (file: File) => Promise<void>;
  reset: () => void;
  mediaFiles: MediaFile[];
  loadMediaFiles: () => Promise<void>;
  isLoadingFiles: boolean;
}

const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'amr', 'webm', 'mp4', 'mkv', 'avi', 'mov'];
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * useMediaUpload - メディアファイルアップロード状態管理・進捗追跡
 *
 * - ファイル形式・サイズのクライアントサイドバリデーション
 * - PresignedURL 取得 → S3 直接アップロード → 進捗表示
 * - メディアファイル一覧の取得
 *
 * Requirements: 2.1
 */
export function useMediaUpload(mediaApi: MediaApi): UseMediaUploadReturn {
  const [uploadState, setUploadState] = useState<UploadState>({
    phase: 'idle',
    progress: 0,
    mediaFileId: null,
    error: null,
  });
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const abortRef = useRef(false);
  const apiRef = useRef(mediaApi);
  useEffect(() => {
    apiRef.current = mediaApi;
  });

  const reset = useCallback(() => {
    abortRef.current = true;
    setUploadState({
      phase: 'idle',
      progress: 0,
      mediaFileId: null,
      error: null,
    });
  }, []);

  const upload = useCallback(async (file: File) => {
    abortRef.current = false;

    // Validation phase
    setUploadState({ phase: 'validating', progress: 0, mediaFileId: null, error: null });

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setUploadState({
        phase: 'error',
        progress: 0,
        mediaFileId: null,
        error: {
          code: 'UNSUPPORTED_FILE_FORMAT',
          message: 'サポートされていないファイル形式です。',
          details: `サポートされる形式: ${ALLOWED_EXTENSIONS.join(', ')}`,
        },
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setUploadState({
        phase: 'error',
        progress: 0,
        mediaFileId: null,
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'ファイルサイズが上限を超えています。',
          details: '最大ファイルサイズ: 2GB',
        },
      });
      return;
    }

    if (abortRef.current) return;

    // Request presigned URL
    setUploadState({ phase: 'requesting-url', progress: 0, mediaFileId: null, error: null });

    const urlResult = await apiRef.current.getUploadUrl({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      fileSize: file.size,
    });

    if (!urlResult.ok) {
      setUploadState({
        phase: 'error',
        progress: 0,
        mediaFileId: null,
        error: urlResult.error,
      });
      return;
    }

    if (abortRef.current) return;

    const { presignedUrl, mediaFileId }: UploadUrlResponse = urlResult.value;

    // Upload to S3
    setUploadState({ phase: 'uploading', progress: 0, mediaFileId, error: null });

    const uploadResult = await apiRef.current.uploadFileToS3(
      presignedUrl,
      file,
      (progress: number) => {
        if (!abortRef.current) {
          setUploadState((prev) => ({ ...prev, progress }));
        }
      },
    );

    if (abortRef.current) return;

    if (!uploadResult.ok) {
      setUploadState({
        phase: 'error',
        progress: 0,
        mediaFileId,
        error: uploadResult.error,
      });
      return;
    }

    setUploadState({ phase: 'completed', progress: 100, mediaFileId, error: null });
  }, []);

  const loadMediaFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    try {
      const result = await apiRef.current.listMediaFiles();
      if (result.ok) {
        setMediaFiles(result.value.data.mediaFiles);
      }
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  return {
    uploadState,
    upload,
    reset,
    mediaFiles,
    loadMediaFiles,
    isLoadingFiles,
  };
}
