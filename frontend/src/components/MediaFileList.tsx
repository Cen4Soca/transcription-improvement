import { useEffect, useState } from 'react';
import type { MediaApi, MediaFile, MediaFileStatus } from '../services/media-api';
import type { DeletionApi } from '../services/deletion-api';

export interface MediaFileListProps {
  mediaApi: MediaApi;
  /** 外部からファイル一覧を更新するためのトリガー（値が変わると再取得） */
  refreshKey?: number;
  /**
   * 外部で取得済みのメディアファイル一覧。指定された場合は自前取得を行わず、
   * この配列をそのまま表示する（親コンポーネントとの二重取得を避けるため）。
   */
  mediaFiles?: MediaFile[];
  /** mediaFiles を外部指定した場合のローディング状態 */
  isLoading?: boolean;
  /** mediaFiles を外部指定した場合のエラーメッセージ */
  error?: string | null;
  /**
   * 削除機能を有効にする場合に指定する DeletionApi。
   * 指定された場合、各ファイルに削除ボタンを表示する。
   * バックエンドが権限に応じて表示可能なファイルのみを返すため、
   * 一覧に表示されているファイルは削除可能とみなす。
   */
  deletionApi?: DeletionApi;
  /** 削除成功時に呼ばれるコールバック（親で一覧を再取得するなど） */
  onDeleted?: (mediaFileId: string) => void;
}

const STATUS_LABELS: Record<MediaFileStatus, string> = {
  UPLOADING: 'アップロード中',
  UPLOADED: 'アップロード完了',
  PROCESSING: '処理中',
  COMPLETED: '完了',
  FAILED: '失敗',
};

const STATUS_STYLES: Record<MediaFileStatus, string> = {
  UPLOADING: 'bg-yellow-100 text-yellow-800',
  UPLOADED: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-purple-100 text-purple-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * MediaFileList - アップロード済みメディアファイルの一覧表示コンポーネント
 *
 * Requirements: 2.2
 */
export function MediaFileList({
  mediaApi,
  refreshKey,
  mediaFiles: externalMediaFiles,
  isLoading: externalIsLoading,
  error: externalError,
  deletionApi,
  onDeleted,
}: MediaFileListProps) {
  // 削除処理中のファイルIDと削除エラーを保持
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (file: MediaFile) => {
    if (!deletionApi) return;

    const confirmed = window.confirm(
      `「${file.filename}」を削除します。この操作は取り消せません。よろしいですか？`
    );
    if (!confirmed) return;

    setDeletingId(file.mediaFileId);
    setDeleteError(null);

    // 1回目: force なしで削除を試みる
    const result = await deletionApi.deleteMediaFile(file.mediaFileId);

    if (result.ok) {
      setDeletingId(null);
      onDeleted?.(file.mediaFileId);
      return;
    }

    // 進行中セッションに紐づく場合、バックエンドは 409（確認要求）を返す。
    // 警告を表示し、ユーザーが同意したら force=true で再実行する。
    const isConfirmationRequired =
      result.error.code === 'CONFIRMATION_REQUIRED' || result.error.statusCode === 409;

    if (isConfirmationRequired) {
      const forceConfirmed = window.confirm(
        `${result.error.message}\n\n進行中の校閲に影響します。それでも削除しますか？`
      );

      if (!forceConfirmed) {
        setDeletingId(null);
        return;
      }

      const forceResult = await deletionApi.deleteMediaFile(file.mediaFileId, {
        force: true,
      });
      setDeletingId(null);

      if (forceResult.ok) {
        onDeleted?.(file.mediaFileId);
      } else {
        setDeleteError(
          `「${file.filename}」の削除に失敗しました: ${forceResult.error.message}`
        );
      }
      return;
    }

    // それ以外のエラー（403 など）はメッセージを表示
    setDeletingId(null);
    setDeleteError(
      `「${file.filename}」の削除に失敗しました: ${result.error.message}`
    );
  };
  // 外部から一覧が渡された場合は自前取得を行わない（制御モード）
  const isControlled = externalMediaFiles !== undefined;

  const [fetchedMediaFiles, setFetchedMediaFiles] = useState<MediaFile[]>([]);
  const [fetchedIsLoading, setFetchedIsLoading] = useState(true);
  const [fetchedError, setFetchedError] = useState<string | null>(null);

  useEffect(() => {
    if (isControlled) return;

    let cancelled = false;

    async function fetchMediaFiles() {
      setFetchedIsLoading(true);
      setFetchedError(null);

      const result = await mediaApi.listMediaFiles();

      if (cancelled) return;

      if (result.ok) {
        setFetchedMediaFiles(result.value.data.mediaFiles);
      } else {
        setFetchedError(result.error.message);
      }
      setFetchedIsLoading(false);
    }

    fetchMediaFiles();

    return () => {
      cancelled = true;
    };
  }, [mediaApi, refreshKey, isControlled]);

  const mediaFiles = isControlled ? externalMediaFiles : fetchedMediaFiles;
  const isLoading = isControlled ? (externalIsLoading ?? false) : fetchedIsLoading;
  const error = isControlled ? (externalError ?? null) : fetchedError;

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-48"
        role="status"
        aria-label="読み込み中"
      >
        <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg" role="alert">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (mediaFiles.length === 0) {
    return (
      <p className="text-center text-gray-500 py-8">
        メディアファイルがありません
      </p>
    );
  }

  return (
    <div className="space-y-2" aria-label="メディアファイル一覧">
      <h2 className="text-lg font-semibold text-gray-900">メディアファイル一覧</h2>

      {deleteError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
          <p className="text-sm text-red-700">{deleteError}</p>
        </div>
      )}

      <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg bg-white" aria-label="メディアファイルリスト">
        {mediaFiles.map((file) => (
          <li
            key={file.mediaFileId}
            className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {file.filename}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatFileSize(file.fileSize)} · {formatDate(file.createdAt)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                アップロード者: {file.uploadedByName ?? file.uploadedBy}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[file.status]}`}
                aria-label={`ステータス: ${STATUS_LABELS[file.status]}`}
              >
                {STATUS_LABELS[file.status]}
              </span>
              {deletionApi && (
                <button
                  type="button"
                  onClick={() => handleDelete(file)}
                  disabled={deletingId === file.mediaFileId}
                  className="text-sm text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`${file.filename} を削除`}
                >
                  {deletingId === file.mediaFileId ? '削除中...' : '削除'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
