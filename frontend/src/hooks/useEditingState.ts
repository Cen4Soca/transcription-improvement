import { useCallback, useState } from 'react';

/**
 * EditingState - 複数Segmentの同時編集状態を管理するインターフェース
 * Requirements: 2.5 (複数Segmentの同時編集)
 */
export interface EditingState {
  editingSegments: Map<string, string>;
  startEditing: (segmentId: string, originalText: string) => void;
  updateText: (segmentId: string, text: string) => void;
  confirmEdit: (segmentId: string) => string | null;
  cancelEdit: (segmentId: string) => void;
  isEditing: (segmentId: string) => boolean;
}

/**
 * useEditingState - 複数Segmentの同時編集状態を管理するカスタムフック
 * Requirements: 2.1, 2.4, 2.5
 */
export function useEditingState(): EditingState {
  const [editingSegments, setEditingSegments] = useState<Map<string, string>>(
    new Map()
  );

  const startEditing = useCallback((segmentId: string, originalText: string) => {
    setEditingSegments((prev) => {
      const next = new Map(prev);
      next.set(segmentId, originalText);
      return next;
    });
  }, []);

  const updateText = useCallback((segmentId: string, text: string) => {
    setEditingSegments((prev) => {
      if (!prev.has(segmentId)) return prev;
      const next = new Map(prev);
      next.set(segmentId, text);
      return next;
    });
  }, []);

  const confirmEdit = useCallback((segmentId: string): string | null => {
    const text = editingSegments.get(segmentId);
    if (text === undefined) return null;
    setEditingSegments((prev) => {
      const next = new Map(prev);
      next.delete(segmentId);
      return next;
    });
    return text;
  }, [editingSegments]);

  const cancelEdit = useCallback((segmentId: string) => {
    setEditingSegments((prev) => {
      if (!prev.has(segmentId)) return prev;
      const next = new Map(prev);
      next.delete(segmentId);
      return next;
    });
  }, []);

  const isEditing = useCallback(
    (segmentId: string): boolean => {
      return editingSegments.has(segmentId);
    },
    [editingSegments]
  );

  return {
    editingSegments,
    startEditing,
    updateText,
    confirmEdit,
    cancelEdit,
    isEditing,
  };
}
