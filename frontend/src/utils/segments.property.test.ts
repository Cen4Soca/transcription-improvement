import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { formatTimestamp, parseTimestamp } from './segments';

describe('Feature: transcription-review-app, Property 2: 開始時刻のHH:MM:SS形式フォーマット', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any non-negative integer seconds (0 to 86399),
   * formatTimestamp output matches /^\d{2}:\d{2}:\d{2}$/ (HH:MM:SS format)
   */
  test('formatTimestamp output matches HH:MM:SS format for any valid seconds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86399 }),
        (seconds) => {
          const result = formatTimestamp(seconds);
          expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any non-negative integer seconds (0 to 86399),
   * parseTimestamp(formatTimestamp(seconds)) === seconds (round-trip)
   */
  test('parseTimestamp(formatTimestamp(seconds)) === seconds (round-trip)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86399 }),
        (seconds) => {
          const formatted = formatTimestamp(seconds);
          const parsed = parseTimestamp(formatted);
          expect(parsed).toBe(seconds);
        }
      ),
      { numRuns: 100 }
    );
  });
});
