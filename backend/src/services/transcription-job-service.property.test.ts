import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateMaxSpeakers } from './transcription-job-service.js';

/**
 * Feature: transcription-workflow-enhancements, Property 4: MaxSpeakerLabels バリデーション
 *
 * **Validates: Requirements 3.3, 3.5**
 *
 * For any integer value, values in range 2-10 are accepted and set correctly in the
 * Transcribe job settings, while values outside this range (below 2 or above 10) are
 * rejected with a validation error.
 */
describe('Feature: transcription-workflow-enhancements, Property 4: MaxSpeakerLabels バリデーション', () => {
  it('values in range [2, 10] pass validation', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10 }), (value) => {
        const result = validateMaxSpeakers(value);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('values below 2 fail validation with range error', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 1 }), (value) => {
        const result = validateMaxSpeakers(value);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('2〜10');
      }),
      { numRuns: 100 }
    );
  });

  it('values above 10 fail validation with range error', () => {
    fc.assert(
      fc.property(fc.integer({ min: 11, max: 200 }), (value) => {
        const result = validateMaxSpeakers(value);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('2〜10');
      }),
      { numRuns: 100 }
    );
  });

  it('non-integer values fail validation with integer error', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 2.01, max: 9.99, noNaN: true }).filter((n) => !Number.isInteger(n)),
        (value) => {
          const result = validateMaxSpeakers(value);
          expect(result.valid).toBe(false);
          expect(result.error).toContain('整数');
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: transcription-review-app, Property 23: MaxSpeakerLabels バリデーション
 *
 * **Validates: Requirements 17.3, 17.5**
 *
 * Verify that validateMaxSpeakers():
 * 1. Accepts all integers in range 2-10 (valid: true)
 * 2. Rejects all integers outside range 2-10 (valid: false)
 * 3. Rejects non-integer values (valid: false)
 */
describe('Feature: transcription-review-app, Property 23: MaxSpeakerLabels バリデーション', () => {
  /**
   * **Validates: Requirements 17.3**
   * All integers in range [2, 10] are accepted as valid MaxSpeakerLabels values.
   */
  it('accepts all integers in range 2-10 (valid: true)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10 }), (value) => {
        const result = validateMaxSpeakers(value);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 17.5**
   * All integers outside range [2, 10] are rejected with valid: false.
   */
  it('rejects all integers outside range 2-10 (valid: false)', () => {
    fc.assert(
      fc.property(
        fc.integer().filter((n) => n < 2 || n > 10),
        (value) => {
          const result = validateMaxSpeakers(value);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 17.5**
   * Non-integer values are rejected with valid: false.
   */
  it('rejects non-integer values (valid: false)', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
        (value) => {
          const result = validateMaxSpeakers(value);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
