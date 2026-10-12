import { useState, useCallback, useRef } from 'react';
import type { MediaApi, UploadUrlResponse } from '../services/media-api';
import { UploadProgress } from '../components/UploadProgress';

/**
 * サポートされるファイル形式
 */
const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'amr', 'webm', 'mp4', 'mkv', 'avi', 'mov'];
const ALLOWED_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  amr: 'audio/amr',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
};
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

type UploadStatus = 'idle' | 'validating' | 'requesting-url' | 'uploading' | 'completed' | 'error';

interface ValidationError {
  type: 'format' | 'size';
  message: string;
}

export interface MediaUploadPageProps {
  mediaApi: MediaApi;
  onUploadComplete?: (mediaFileId: string) => void;
}

/**
 * ファイル拡張子を取得する
 */
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * ファイルサイズを人間が読みやすい形式にフォーマットする
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * ファイルのバリデーションを実行する
 */
function validateFile(file: File): ValidationError | null {
  const ext = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      type: 'format',
      message: `サポートされていないファイル形式です。サポートされる形式: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      type: 'size',
      message: `ファイルサイズが上限（2GB）を超えています。選択されたファイル: ${formatFileSize(file.size)}`,
    };
  }

  return null;
}

/**
 * MediaUploadPage - メディアファイルアップロードページ
 *
 * - ファイル選択（ドラッグ＆ドロップ対応）
 * - クライアントサイドバリデーション（ファイル形式・サイズ）
 * - PresignedURL 取得 → S3 直接アップロード → 進捗表示
 * - エラーメッセージ表示
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6
 */
export function MediaUploadPage({ mediaApi, onUploadComplete }: MediaUploadPageProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadUrlResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setSelectedFile(null);
    setUploadStatus('idle');
    setUploadProgress(0);
    setError(null);
    setUploadResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    setError(null);
    setUploadStatus('validating');
    setUploadResult(null);

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError.message);
      setUploadStatus('error');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setUploadStatus('idle');
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);

      const file = event.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setError(null);
    setUploadStatus('requesting-url');

    const ext = getFileExtension(selectedFile.name);
    const contentType = ALLOWED_MIME_TYPES[ext] || selectedFile.type;

    // Step 1: Get presigned URL
    const urlResult = await mediaApi.getUploadUrl({
      filename: selectedFile.name,
      contentType,
      fileSize: selectedFile.size,
    });

    if (!urlResult.ok) {
      setError(urlResult.error.message);
      setUploadStatus('error');
      return;
    }

    setUploadResult(urlResult.value);
    setUploadStatus('uploading');
    setUploadProgress(0);

    // Step 2: Upload file to S3 using presigned URL
    const uploadResult = await mediaApi.uploadFileToS3(
      urlResult.value.presignedUrl,
      selectedFile,
      (progress) => setUploadProgress(progress),
    );

    if (!uploadResult.ok) {
      setError(uploadResult.error.message);
      setUploadStatus('error');
      return;
    }

    setUploadStatus('completed');
    setUploadProgress(100);
    onUploadComplete?.(urlResult.value.mediaFileId);
  }, [selectedFile, mediaApi, onUploadComplete]);

  const handleClickDropZone = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const isUploading = uploadStatus === 'requesting-url' || uploadStatus === 'uploading';

  return (
    <div className="flex flex-col h-full" role="main" aria-label="メディアアップロード">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">メディアアップロード</h1>
        <p className="mt-1 text-sm text-gray-500">
          音声・動画ファイルをアップロードして文字起こしを作成します
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Hidden file input (outside drop zone to avoid nested-interactive) */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
            onChange={handleInputChange}
            className="sr-only"
            tabIndex={-1}
            disabled={isUploading}
            aria-label="ファイルを選択"
          />

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="ファイルを選択またはドラッグ＆ドロップ"
            onClick={handleClickDropZone}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClickDropZone();
              }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isDragOver
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
            } ${isUploading ? 'pointer-events-none opacity-60' : ''}`}
          >

            <div className="space-y-2">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-sm text-gray-600">
                <span className="font-medium text-blue-600">ファイルを選択</span>
                {' '}またはドラッグ＆ドロップ
              </p>
              <p className="text-xs text-gray-500">
                対応形式: {ALLOWED_EXTENSIONS.join(', ')} / 最大 2GB
              </p>
            </div>
          </div>

          {/* Selected file info */}
          {selectedFile && (
            <div className="bg-white border border-gray-200 rounded-lg p-4" aria-label="選択されたファイル">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <svg
                    className="h-8 w-8 text-gray-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                    />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </div>
                {uploadStatus === 'idle' && (
                  <button
                    type="button"
                    onClick={resetState}
                    className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
                    aria-label="ファイル選択を解除"
                  >
                    取消
                  </button>
                )}
              </div>

              {/* Progress bar */}
              {(uploadStatus === 'uploading' || uploadStatus === 'completed') && (
                <UploadProgress
                  progress={uploadProgress}
                  isCompleted={uploadStatus === 'completed'}
                />
              )}

              {uploadStatus === 'requesting-url' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
                  <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                  <span>アップロード準備中...</span>
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div
              className="bg-red-50 border border-red-200 rounded-lg p-4"
              role="alert"
              aria-live="assertive"
            >
              <div className="flex items-start gap-3">
                <svg
                  className="h-5 w-5 text-red-500 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {/* Success message */}
          {uploadStatus === 'completed' && uploadResult && (
            <div
              className="bg-green-50 border border-green-200 rounded-lg p-4"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <svg
                  className="h-5 w-5 text-green-500 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-green-700">
                    アップロードが完了しました
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    メディアファイルID: {uploadResult.mediaFileId}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Upload button */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleUpload}
              disabled={!selectedFile || isUploading || uploadStatus === 'completed'}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUploading ? 'アップロード中...' : 'アップロード開始'}
            </button>

            {uploadStatus === 'completed' && (
              <button
                type="button"
                onClick={resetState}
                className="px-4 py-2.5 bg-white text-gray-700 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                別のファイルをアップロード
              </button>
            )}
          </div>

          {/* Supported formats info */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-medium text-gray-700 mb-2">対応ファイル形式</h2>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
              <div>
                <p className="font-medium text-gray-700 mb-1">音声</p>
                <p>mp3, wav, flac, ogg, m4a, amr, webm</p>
              </div>
              <div>
                <p className="font-medium text-gray-700 mb-1">動画</p>
                <p>mp4, webm, mkv, avi, mov</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">最大ファイルサイズ: 2GB</p>
          </div>
        </div>
      </div>
    </div>
  );
}
