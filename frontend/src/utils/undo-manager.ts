/**
 * UndoEntry - Stores the state before and after a Correction was applied
 * Used to restore segment text to its previous value on undo
 */
export interface UndoEntry {
  segmentId: string;
  beforeText: string;
  afterText: string;
  correctionId: string;
}

/**
 * UndoManager - Manages an undo stack for Correction operations
 * Maintains a maximum of 50 entries (oldest entries are discarded when exceeded)
 * Requirements: 3.6, 3.8
 */
export class UndoManager {
  static readonly MAX_SIZE = 50;

  private stack: UndoEntry[] = [];

  /**
   * Push a new undo entry onto the stack.
   * If the stack exceeds MAX_SIZE, the oldest entry is removed.
   */
  push(entry: UndoEntry): void {
    this.stack.push(entry);
    if (this.stack.length > UndoManager.MAX_SIZE) {
      this.stack.shift();
    }
  }

  /**
   * Pop the most recent entry and return it (the state to restore).
   * Returns null if the stack is empty.
   */
  undo(): UndoEntry | null {
    return this.stack.pop() ?? null;
  }

  /**
   * Returns true if there are entries in the stack that can be undone.
   */
  canUndo(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Clear all entries from the undo stack.
   */
  clear(): void {
    this.stack = [];
  }

  /**
   * Current number of entries in the undo stack.
   */
  get size(): number {
    return this.stack.length;
  }
}
