import { useCallback, useRef, useState } from 'react';
import { type UndoEntry, UndoManager } from '../utils/undo-manager';

/**
 * useUndoManager - React hook that wraps UndoManager for use in components
 * Provides reactive state updates when the undo stack changes.
 * Requirements: 3.8
 */
export interface UseUndoManagerReturn {
  push: (entry: UndoEntry) => void;
  undo: () => UndoEntry | null;
  canUndo: boolean;
  clear: () => void;
  size: number;
}

export function useUndoManager(): UseUndoManagerReturn {
  const managerRef = useRef(new UndoManager());
  const [size, setSize] = useState(0);

  const push = useCallback((entry: UndoEntry) => {
    managerRef.current.push(entry);
    setSize(managerRef.current.size);
  }, []);

  const undo = useCallback((): UndoEntry | null => {
    const entry = managerRef.current.undo();
    setSize(managerRef.current.size);
    return entry;
  }, []);

  const clear = useCallback(() => {
    managerRef.current.clear();
    setSize(0);
  }, []);

  return {
    push,
    undo,
    canUndo: size > 0,
    clear,
    size,
  };
}
