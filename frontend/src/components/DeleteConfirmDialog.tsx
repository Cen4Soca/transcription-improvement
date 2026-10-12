import { useState, useRef, useEffect, useCallback } from 'react';

export interface DeleteConfirmDialogProps {
  isOpen: boolean;
  title: string;
  resourceName: string;
  warningMessage?: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * DeleteConfirmDialog - 削除確認ダイアログ
 *
 * - ファイル名・操作不可逆の警告表示
 * - 確認ボタン押下で削除実行
 * - 削除成功/失敗のフィードバック表示
 * - フォーカストラップ（モーダル内にフォーカスを閉じ込め）
 * - Escape キーで閉じる
 *
 * Requirements: 7.3, 7.5, 7.8, 11.2
 */
export function DeleteConfirmDialog({
  isOpen,
  title,
  resourceName,
  warningMessage = 'この操作は取り消せません。削除されたデータは復元できません。',
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Reset dialog state when it closes (adjust state during render).
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setError(null);
      setIsDeleting(false);
    }
  }

  // Store the previously focused element and restore on close
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      cancelButtonRef.current?.focus();
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Focus trap: keep focus within the dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      }
    },
    [isDeleting, onCancel],
  );

  async function handleConfirm() {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      const message = e instanceof Error ? e.message : '削除に失敗しました';
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-description"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        aria-hidden="true"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div ref={dialogRef} className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2
          id="delete-dialog-title"
          className="text-lg font-semibold text-gray-900 mb-2"
        >
          {title}
        </h2>

        <div className="space-y-3 mb-6">
          <p id="delete-dialog-description" className="text-sm text-gray-700">
            以下のリソースを削除しようとしています：
          </p>
          <p className="text-sm font-medium text-gray-900 bg-gray-100 px-3 py-2 rounded">
            {resourceName}
          </p>
          <p className="text-sm text-red-600 flex items-start gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{warningMessage}</span>
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={isDeleting}
          >
            {isDeleting ? '削除中...' : '削除する'}
          </button>
        </div>
      </div>
    </div>
  );
}
