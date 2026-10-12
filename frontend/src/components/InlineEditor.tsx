import { useCallback, useRef, useState } from 'react';

/**
 * InlineEditorProps - インライン編集コンポーネントのプロパティ
 */
export interface InlineEditorProps {
  segmentId: string;
  originalText: string;
  onConfirm: (segmentId: string, newText: string) => void;
  onCancel: (segmentId: string) => void;
}

/**
 * InlineEditor - Segmentテキストのインライン編集コンポーネント
 *
 * Requirements:
 * - 2.1: クリックで編集モード
 * - 2.2: 編集前テキストと編集中テキストの同時表示
 * - 2.3: 編集確定操作
 * - 2.4: 編集キャンセル操作
 * - 2.5: 複数Segmentの同時編集（各InlineEditorが独立して動作）
 * - 2.7: 空文字列確定時の確認ダイアログ
 * - 11.5: IME入力の正しい処理
 */
export function InlineEditor({
  segmentId,
  originalText,
  onConfirm,
  onCancel,
}: InlineEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(originalText);
  const [showEmptyConfirmDialog, setShowEmptyConfirmDialog] = useState(false);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleStartEditing = useCallback(() => {
    setIsEditing(true);
    setEditText(originalText);
    // Focus textarea after render
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, [originalText]);

  const handleConfirm = useCallback(() => {
    const trimmedText = editText;
    if (trimmedText === '') {
      setShowEmptyConfirmDialog(true);
      return;
    }
    setIsEditing(false);
    onConfirm(segmentId, trimmedText);
  }, [editText, segmentId, onConfirm]);

  const handleEmptyConfirm = useCallback(() => {
    setShowEmptyConfirmDialog(false);
    setIsEditing(false);
    onConfirm(segmentId, '');
  }, [segmentId, onConfirm]);

  const handleEmptyCancel = useCallback(() => {
    setShowEmptyConfirmDialog(false);
  }, []);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditText(originalText);
    onCancel(segmentId);
  }, [originalText, segmentId, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME入力中はキーイベントを無視 (Requirement 11.5)
      if (isComposingRef.current) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleCancel]
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  const handleTextClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isEditing) {
        handleStartEditing();
      }
    },
    [isEditing, handleStartEditing]
  );

  const handleTextKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleStartEditing();
      }
    },
    [isEditing, handleStartEditing]
  );

  if (!isEditing) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`テキストを編集: ${originalText}`}
        onClick={handleTextClick}
        onKeyDown={handleTextKeyDown}
        className="flex-1 text-sm text-gray-900 leading-relaxed cursor-pointer hover:bg-gray-100 rounded px-2 py-1 transition-colors"
      >
        {originalText}
      </div>
    );
  }

  return (
    <div
      className="flex-1 space-y-2"
      aria-label="インライン編集"
      role="group"
    >
      {/* Requirement 2.2: 編集前テキストの表示 */}
      <div
        className="text-sm text-gray-400 line-through px-2 py-1"
        aria-label="編集前テキスト"
      >
        {originalText}
      </div>

      {/* Requirement 2.2: 編集中テキストの表示 */}
      <textarea
        ref={textareaRef}
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        aria-label="編集テキスト"
        className="w-full text-sm text-gray-900 border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y min-h-[2.5rem]"
        rows={2}
      />

      {/* Requirement 2.3, 2.4: 確定・キャンセルボタン */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          aria-label="編集を確定"
          className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
        >
          確定
        </button>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="編集をキャンセル"
          className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
        >
          キャンセル
        </button>
      </div>

      {/* Requirement 2.7: 空文字列確定時の確認ダイアログ */}
      {showEmptyConfirmDialog && (
        <div
          role="alertdialog"
          aria-labelledby={`empty-confirm-title-${segmentId}`}
          aria-describedby={`empty-confirm-desc-${segmentId}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3
              id={`empty-confirm-title-${segmentId}`}
              className="text-lg font-semibold text-gray-900 mb-2"
            >
              確認
            </h3>
            <p
              id={`empty-confirm-desc-${segmentId}`}
              className="text-sm text-gray-600 mb-4"
            >
              テキストが空です。空文字列として確定しますか？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={handleEmptyCancel}
                aria-label="空文字列確定をキャンセル"
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleEmptyConfirm}
                aria-label="空文字列として確定"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
