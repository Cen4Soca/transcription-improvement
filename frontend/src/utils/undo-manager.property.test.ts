import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { UndoManager } from './undo-manager';
import type { UndoEntry } from './undo-manager';

const undoEntryArb = fc.record({
  segmentId: fc.uuid(),
  beforeText: fc.string({ minLength: 0, maxLength: 200 }),
  afterText: fc.string({ minLength: 0, maxLength: 200 }),
  correctionId: fc.uuid(),
});

describe('Feature: transcription-review-app, Property 10: アンドゥ操作の正確性', () => {
  /**
   * **Validates: Requirements 3.8**
   *
   * For any sequence of 1-50 push operations followed by one undo,
   * the undo returns the last pushed entry.
   */
  test('1〜50件のpush後にundoすると、最後にpushしたエントリが返される', () => {
    fc.assert(
      fc.property(
        fc.array(undoEntryArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const manager = new UndoManager();

          for (const entry of entries) {
            manager.push(entry);
          }

          const undone = manager.undo();
          const lastEntry = entries[entries.length - 1];

          expect(undone).not.toBeNull();
          expect(undone!.correctionId).toBe(lastEntry.correctionId);
          expect(undone!.segmentId).toBe(lastEntry.segmentId);
          expect(undone!.beforeText).toBe(lastEntry.beforeText);
          expect(undone!.afterText).toBe(lastEntry.afterText);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.8**
   *
   * The maximum undo stack size is 50 — after pushing more than 50 entries,
   * only the 50 most recent can be undone.
   */
  test('50件を超えるpush後、undoできるのは最新の50件のみ', () => {
    fc.assert(
      fc.property(
        fc.array(undoEntryArb, { minLength: 51, maxLength: 70 }),
        (entries) => {
          const manager = new UndoManager();

          for (const entry of entries) {
            manager.push(entry);
          }

          // Stack size should be capped at 50
          expect(manager.size).toBe(50);

          // Undo all 50 entries
          const undoneEntries: UndoEntry[] = [];
          while (manager.canUndo()) {
            const undone = manager.undo();
            if (undone) undoneEntries.push(undone);
          }

          expect(undoneEntries.length).toBe(50);

          // The undone entries should be the last 50 pushed entries in reverse order
          const expectedEntries = entries.slice(-50).reverse();
          for (let i = 0; i < 50; i++) {
            expect(undoneEntries[i].correctionId).toBe(expectedEntries[i].correctionId);
            expect(undoneEntries[i].segmentId).toBe(expectedEntries[i].segmentId);
            expect(undoneEntries[i].beforeText).toBe(expectedEntries[i].beforeText);
            expect(undoneEntries[i].afterText).toBe(expectedEntries[i].afterText);
          }

          // After undoing all 50, no more undo is possible
          expect(manager.canUndo()).toBe(false);
          expect(manager.undo()).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.8**
   *
   * After pushing N entries (N <= 50), undoing N times returns all entries
   * in reverse order.
   */
  test('N件(N<=50)のpush後、N回undoすると全エントリが逆順で返される', () => {
    fc.assert(
      fc.property(
        fc.array(undoEntryArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const manager = new UndoManager();

          for (const entry of entries) {
            manager.push(entry);
          }

          expect(manager.size).toBe(entries.length);

          // Undo all entries
          const undoneEntries: UndoEntry[] = [];
          for (let i = 0; i < entries.length; i++) {
            const undone = manager.undo();
            expect(undone).not.toBeNull();
            undoneEntries.push(undone!);
          }

          // Verify reverse order
          const expectedReversed = [...entries].reverse();
          for (let i = 0; i < entries.length; i++) {
            expect(undoneEntries[i].correctionId).toBe(expectedReversed[i].correctionId);
            expect(undoneEntries[i].segmentId).toBe(expectedReversed[i].segmentId);
            expect(undoneEntries[i].beforeText).toBe(expectedReversed[i].beforeText);
            expect(undoneEntries[i].afterText).toBe(expectedReversed[i].afterText);
          }

          // Stack should be empty now
          expect(manager.canUndo()).toBe(false);
          expect(manager.size).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
