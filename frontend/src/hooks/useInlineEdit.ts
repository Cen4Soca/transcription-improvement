import { useCallback, useState } from 'react';

/**
 * InlineEditEntry - 編集中のSegmentの状態
 */
export interface InlineEditEntry {
  segmentId: string;
  originalText: string;
  editText: string;
}

/**
 * UseInlineEditReturn - useInlineEditフックの戻り値
 */
export interface UseInlineEditReturn {
  /** 現在編集中のSegment一覧 */
  editingEntries: Map<string, InlineEditEntry>;
  /** 編集を開始する */
  startEdit: (segmentId: string, originalText: string) => void;
  /** 編集テキストを更新する */
  updateEditText: (segmentId: string, text: string) => void;
  /** 編集を確定する（変更なしの場合はnullを返す） */
  confirmEdit: (segmentId: string) => { originalText: string; newText: string } | null;
  /** 編集をキャンセルする */
  cancelEdit: (segmentId: string) => void;
  /** 指定Segmentが編集中かどうか */
  isEditing: (segmentId: string) => boolean;
  /** 編集中のSegment数 */
  editingCount: number;
}

/**
 * useInlineEdit - 複数Segmentのインライン編集状態を管理するカスタムフック
 *
 * Requirements:
 * - 2.1: クリックで編集モード
 * - 2.2: 編集前テキストと編集中テキストの同時表示
 * - 2.3: 編集確定操作（Ctrl+Enter / 確定ボタン）
 * - 2.4: 編集キャンセル操作（Escape / キャンセルボタン）
 * - 2.5: 複数Segmentの同時編集をサポート
 * - 2.6: テキスト変更なし確定時はCorrectionを記録しない
 */
export function useInlineEdit(): UseInlineEditReturn {
  const [editingEntries, setEditingEntries] = useState<Map<string, InlineEditEntry>>(
    new Map()
  );

  const startEdit = useCallback((segmentId: string, originalText: string) => {
    setEditingEntries((prev) => {
      const next = new Map(prev);
      next.set(segmentId, {
        segmentId,
        originalText,
        editText: originalText,
      });
      return next;
    });
  }, []);

  const updateEditText = useCallback((segmentId: string, text: string) => {
    setEditingEntries((prev) => {
      const entry = prev.get(segmentId);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(segmentId, { ...entry, editText: text });
      return next;
    });
  }, []);

  const confirmEdit = useCallback(
    (segmentId: string): { originalText: string; newText: string } | null => {
      const entry = editingEntries.get(segmentId);
      if (!entry) return null;

      // Requirement 2.6: テキスト変更なし確定時はCorrectionを記録しない
      if (entry.editText === entry.originalText) {
        setEditingEntries((prev) => {
          const next = new Map(prev);
          next.delete(segmentId);
          return next;
        });
        return null;
      }

      setEditingEntries((prev) => {
        const next = new Map(prev);
        next.delete(segmentId);
        return next;
      });

      return { originalText: entry.originalText, newText: entry.editText };
    },
    [editingEntries]
  );

  const cancelEdit = useCallback((segmentId: string) => {
    setEditingEntries((prev) => {
      if (!prev.has(segmentId)) return prev;
      const next = new Map(prev);
      next.delete(segmentId);
      return next;
    });
  }, []);

  const isEditing = useCallback(
    (segmentId: string): boolean => {
      return editingEntries.has(segmentId);
    },
    [editingEntries]
  );

  return {
    editingEntries,
    startEdit,
    updateEditText,
    confirmEdit,
    cancelEdit,
    isEditing,
    editingCount: editingEntries.size,
  };
}
