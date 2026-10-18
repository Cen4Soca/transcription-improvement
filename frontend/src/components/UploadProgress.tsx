export interface UploadProgressProps {
  /** Current upload progress percentage (0-100) */
  progress: number;
  /** Whether the upload has completed */
  isCompleted: boolean;
}

/**
 * UploadProgress - パーセンテージ表示のプログレスバー
 *
 * アップロード中の進捗をパーセンテージとプログレスバーで表示する。
 * 完了時は緑色、アップロード中は青色で表示する。
 *
 * Requirements: 16.9
 */
export function UploadProgress({ progress, isCompleted }: UploadProgressProps) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
        <span>
          {isCompleted ? 'アップロード完了' : 'アップロード中...'}
        </span>
        <span>{progress}%</span>
      </div>
      <div
        className="w-full bg-gray-200 rounded-full h-2"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="アップロード進捗"
      >
        <div
          className={`h-2 rounded-full transition-all duration-300 ${
            isCompleted ? 'bg-green-500' : 'bg-blue-600'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
