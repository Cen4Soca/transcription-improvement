import { describe, expect, it } from 'vitest';
import { type UndoEntry, UndoManager } from './undo-manager';

function createEntry(overrides: Partial<UndoEntry> = {}): UndoEntry {
  return {
    correctionId: `correction-${Math.random().toString(36).slice(2)}`,
    segmentId: `segment-1`,
    beforeText: 'original text',
    afterText: 'corrected text',
    ...overrides,
  };
}

describe('UndoManager', () => {
  it('starts with an empty stack', () => {
    const manager = new UndoManager();
    expect(manager.size).toBe(0);
    expect(manager.canUndo()).toBe(false);
  });

  it('has MAX_SIZE of 50', () => {
    expect(UndoManager.MAX_SIZE).toBe(50);
  });

  it('push adds an entry to the stack', () => {
    const manager = new UndoManager();
    const entry = createEntry();
    manager.push(entry);
    expect(manager.size).toBe(1);
    expect(manager.canUndo()).toBe(true);
  });

  it('undo returns the most recent entry (LIFO order)', () => {
    const manager = new UndoManager();
    const entry1 = createEntry({ beforeText: 'first' });
    const entry2 = createEntry({ beforeText: 'second' });
    manager.push(entry1);
    manager.push(entry2);

    const undone = manager.undo();
    expect(undone).toEqual(entry2);
    expect(manager.size).toBe(1);

    const undone2 = manager.undo();
    expect(undone2).toEqual(entry1);
    expect(manager.size).toBe(0);
  });

  it('undo returns null when stack is empty', () => {
    const manager = new UndoManager();
    expect(manager.undo()).toBeNull();
  });

  it('canUndo returns false after all entries are undone', () => {
    const manager = new UndoManager();
    manager.push(createEntry());
    manager.undo();
    expect(manager.canUndo()).toBe(false);
  });

  it('clear removes all entries', () => {
    const manager = new UndoManager();
    manager.push(createEntry());
    manager.push(createEntry());
    manager.push(createEntry());
    expect(manager.size).toBe(3);

    manager.clear();
    expect(manager.size).toBe(0);
    expect(manager.canUndo()).toBe(false);
    expect(manager.undo()).toBeNull();
  });

  it('enforces maximum stack size of 50', () => {
    const manager = new UndoManager();
    const entries: UndoEntry[] = [];

    for (let i = 0; i < 52; i++) {
      const entry = createEntry({ beforeText: `text-${i}` });
      entries.push(entry);
      manager.push(entry);
    }

    expect(manager.size).toBe(50);

    // The oldest 2 entries (index 0, 1) should have been removed
    // The most recent entry should be the last one pushed
    const undone = manager.undo();
    expect(undone?.beforeText).toBe('text-51');

    // After undoing all 50, the first available should be index 2
    for (let i = 0; i < 48; i++) {
      manager.undo();
    }
    const oldest = manager.undo();
    expect(oldest?.beforeText).toBe('text-2');
    expect(manager.size).toBe(0);
  });

  it('undo restores segment text to beforeText', () => {
    const manager = new UndoManager();
    const entry = createEntry({
      segmentId: 'seg-123',
      beforeText: 'original',
      afterText: 'modified',
      correctionId: 'corr-456',
    });
    manager.push(entry);

    const undone = manager.undo();
    expect(undone?.segmentId).toBe('seg-123');
    expect(undone?.beforeText).toBe('original');
    expect(undone?.afterText).toBe('modified');
    expect(undone?.correctionId).toBe('corr-456');
  });

  it('entries beyond 50 are not undoable', () => {
    const manager = new UndoManager();

    // Push 55 entries
    for (let i = 0; i < 55; i++) {
      manager.push(createEntry({ beforeText: `text-${i}` }));
    }

    expect(manager.size).toBe(50);

    // The oldest 5 entries (0-4) should be gone
    // Undo all 50 and verify the oldest available is index 5
    const undoneTexts: string[] = [];
    while (manager.canUndo()) {
      const undone = manager.undo();
      if (undone) undoneTexts.push(undone.beforeText);
    }

    expect(undoneTexts.length).toBe(50);
    // Most recent first (LIFO)
    expect(undoneTexts[0]).toBe('text-54');
    // Oldest available last
    expect(undoneTexts[49]).toBe('text-5');
  });

  it('push at exactly max size does not exceed limit', () => {
    const manager = new UndoManager();
    for (let i = 0; i < 50; i++) {
      manager.push(createEntry({ beforeText: `text-${i}` }));
    }
    expect(manager.size).toBe(50);

    // Push one more - should still be 50
    manager.push(createEntry({ beforeText: 'text-50' }));
    expect(manager.size).toBe(50);
  });
});
