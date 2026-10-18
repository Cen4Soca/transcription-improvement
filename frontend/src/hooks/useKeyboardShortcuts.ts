import { useEffect, useRef, useCallback } from 'react';

export interface UseKeyboardShortcutsOptions {
  onTogglePlayPause?: () => void;
  onNextSegment?: () => void;
  onPreviousSegment?: () => void;
  onUndo?: () => void;
  onConfirmEdit?: () => void;
  onCancelEdit?: () => void;
  onFocusSearch?: () => void;
  enabled?: boolean;
}

/**
 * useKeyboardShortcuts - キーボードショートカットを一元管理するカスタムフック
 *
 * - スペースキー: 再生・一時停止（入力フィールド外のみ）
 * - Tab: 次のSegmentに移動
 * - Shift+Tab: 前のSegmentに移動
 * - Ctrl+Z / Cmd+Z: アンドゥ
 * - Ctrl+Enter / Cmd+Enter: 編集確定
 * - Escape: 編集キャンセル
 * - Ctrl+F / Cmd+F: 検索バーにフォーカス
 * - IME入力中（isComposing === true）はショートカットを無効化
 *
 * Requirements: 11.1, 11.5
 */
export function useKeyboardShortcuts({
  onTogglePlayPause,
  onNextSegment,
  onPreviousSegment,
  onUndo,
  onConfirmEdit,
  onCancelEdit,
  onFocusSearch,
  enabled = true,
}: UseKeyboardShortcutsOptions): void {
  const isComposingRef = useRef(false);

  const isEditableElement = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;

    const tagName = target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') return true;
    if (
      target.isContentEditable ||
      target.contentEditable === 'true' ||
      target.getAttribute('contenteditable') === 'true'
    ) {
      return true;
    }

    return false;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore during IME composition (Req 11.5)
      if (event.isComposing || isComposingRef.current) return;

      const { key, shiftKey, ctrlKey, metaKey } = event;
      const modKey = ctrlKey || metaKey;

      // Ctrl+F / Cmd+F: Focus search bar
      if (modKey && key === 'f') {
        if (onFocusSearch) {
          event.preventDefault();
          onFocusSearch();
        }
        return;
      }

      // Ctrl+Z / Cmd+Z: Undo
      if (modKey && key === 'z' && !shiftKey) {
        if (onUndo) {
          event.preventDefault();
          onUndo();
        }
        return;
      }

      // Ctrl+Enter / Cmd+Enter: Confirm edit
      if (modKey && key === 'Enter') {
        if (onConfirmEdit) {
          event.preventDefault();
          onConfirmEdit();
        }
        return;
      }

      // Escape: Cancel edit
      if (key === 'Escape') {
        if (onCancelEdit) {
          event.preventDefault();
          onCancelEdit();
        }
        return;
      }

      // Space: Toggle play/pause (only when not in editable element)
      if (key === ' ') {
        if (isEditableElement(event.target)) return;
        if (onTogglePlayPause) {
          event.preventDefault();
          onTogglePlayPause();
        }
        return;
      }

      // Tab / Shift+Tab: Segment navigation (only when not in editable element)
      if (key === 'Tab') {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        if (shiftKey) {
          if (onPreviousSegment) {
            onPreviousSegment();
          }
        } else {
          if (onNextSegment) {
            onNextSegment();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('compositionstart', handleCompositionStart);
    document.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('compositionstart', handleCompositionStart);
      document.removeEventListener('compositionend', handleCompositionEnd);
    };
  }, [
    enabled,
    onTogglePlayPause,
    onNextSegment,
    onPreviousSegment,
    onUndo,
    onConfirmEdit,
    onCancelEdit,
    onFocusSearch,
    isEditableElement,
  ]);
}
