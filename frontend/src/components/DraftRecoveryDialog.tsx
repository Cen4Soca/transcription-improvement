import { useRef, useEffect, useCallback } from 'react';
import type { DraftInfo } from '../services/draft-storage';

export interface DraftRecoveryDialogProps {
  isOpen: boolean;
  drafts: DraftInfo[];
  onRestore: (drafts: DraftInfo[]) => void;
  onDiscard: () => void;
}

/**
 * DraftRecoveryDialog - ブラウザクラッシュ後の再オープン時に未確定編集内容の復元確認ダイアログ
 *
 * - 未保存ドラフトが存在する場合に表示
 * - セグメント一覧を表示
 * - 「復元する」ボタンでドラフトを復元
 * - 「破棄する」ボタンでドラフトを削除して新規開始
 * - ARIA属性によるアクセシビリティ対応
 *
 * Requirements: 11.9
 */
export function DraftRecoveryDialog({
  isOpen,
  drafts,
  onRestore,
  onDiscard,
}: DraftRecoveryDialogProps) {
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      restoreButtonRef.current?.focus();
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDiscard();
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
    [onDiscard],
  );

  function handleRestore() {
    onRestore(drafts);
  }

  function handleDiscard() {
    onDiscard();
  }

  if (!isOpen || drafts.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-recovery-dialog-title"
      aria-describedby="draft-recovery-dialog-description"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        aria-hidden="true"
      />

      {/* Dialog */}
      <div ref={dialogRef} className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2
          id="draft-recovery-dialog-title"
          className="text-lg font-semibold text-gray-900 mb-2"
        >
          未保存の編集内容があります
        </h2>

        <p
          id="draft-recovery-dialog-description"
          className="text-sm text-gray-700 mb-4"
        >
          前回のセッションで保存されていない編集内容が見つかりました。復元しますか？
        </p>

        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-2">
            対象セグメント（{drafts.length}件）:
          </p>
          <ul className="max-h-40 overflow-y-auto space-y-1" aria-label="未保存ドラフト一覧">
            {drafts.map((draft) => (
              <li
                key={draft.segmentId}
                className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded"
              >
                <span className="font-mono text-xs text-gray-500">
                  {draft.segmentId}
                </span>
                <span className="ml-2 truncate">
                  {draft.text.length > 50
                    ? `${draft.text.slice(0, 50)}...`
                    : draft.text}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleDiscard}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            破棄する
          </button>
          <button
            ref={restoreButtonRef}
            type="button"
            onClick={handleRestore}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            復元する
          </button>
        </div>
      </div>
    </div>
  );
}
