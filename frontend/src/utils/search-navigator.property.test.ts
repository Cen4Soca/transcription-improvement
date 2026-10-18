import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { SearchNavigator } from './search-navigator';

describe('Feature: transcription-review-app, Property 12: 検索ナビゲーションの循環性', () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * After N next() calls where N equals matchCount, the navigator returns to index 0 (circular).
   * Starting from a fresh navigator (first next() goes to 0), calling next() matchCount more times
   * should return to 0.
   */
  test('After N next() calls where N equals matchCount, the navigator returns to index 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (matchCount) => {
          const navigator = new SearchNavigator();
          navigator.setMatchCount(matchCount);

          // First next() call moves to index 0
          navigator.next();
          expect(navigator.getCurrentIndex()).toBe(0);

          // Call next() matchCount times from index 0
          for (let i = 0; i < matchCount; i++) {
            navigator.next();
          }

          // Should be back at index 0 (circular)
          expect(navigator.getCurrentIndex()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * After N previous() calls where N equals matchCount, the navigator returns to the starting index (circular).
   * From any valid starting position, calling previous() matchCount times returns to the same position.
   */
  test('After N previous() calls where N equals matchCount, the navigator returns to the starting index', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (matchCount, initialSteps) => {
          const navigator = new SearchNavigator();
          navigator.setMatchCount(matchCount);

          // Move to a valid starting position
          for (let i = 0; i < initialSteps; i++) {
            navigator.next();
          }

          const startPosition = navigator.getCurrentIndex();

          // Call previous() matchCount times
          for (let i = 0; i < matchCount; i++) {
            navigator.previous();
          }

          const endPosition = navigator.getCurrentIndex();

          expect(endPosition).toBe(startPosition);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * next() from the last position (matchCount - 1) wraps to 0.
   */
  test('next() from the last position wraps to 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (matchCount) => {
          const navigator = new SearchNavigator();
          navigator.setMatchCount(matchCount);

          // Navigate to the last position (matchCount - 1)
          // First next() goes to 0, then we need (matchCount - 1) more calls to reach the last position
          for (let i = 0; i < matchCount; i++) {
            navigator.next();
          }

          // Now at position matchCount - 1
          expect(navigator.getCurrentIndex()).toBe(matchCount - 1);

          // next() should wrap to 0
          const result = navigator.next();
          expect(result).toBe(0);
          expect(navigator.getCurrentIndex()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * previous() from position 0 wraps to matchCount - 1.
   */
  test('previous() from position 0 wraps to matchCount - 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (matchCount) => {
          const navigator = new SearchNavigator();
          navigator.setMatchCount(matchCount);

          // Navigate to position 0
          navigator.next();
          expect(navigator.getCurrentIndex()).toBe(0);

          // previous() from position 0 should wrap to matchCount - 1
          const result = navigator.previous();
          expect(result).toBe(matchCount - 1);
          expect(navigator.getCurrentIndex()).toBe(matchCount - 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
