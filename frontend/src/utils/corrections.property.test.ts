import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import {
  createTextCorrection,
  createSpeakerCorrection,
  createSpeakerRenameCorrection,
} from './corrections';

describe('Feature: transcription-review-app, Property 5: Correctionの完全性（テキスト・話者）', () => {
  /**
   * **Validates: Requirements 2.3**
   *
   * For any (beforeText, afterText) pair where beforeText !== afterText,
   * createTextCorrection returns a Correction containing both beforeText and afterText.
   */
  test('テキスト変更時、Correction に beforeText と afterText の両方が含まれる', () => {
    fc.assert(
      fc.property(
        fc.record({
          sessionId: fc.uuid(),
          segmentId: fc.uuid(),
          userId: fc.uuid(),
          beforeText: fc.string({ minLength: 0, maxLength: 200 }),
          afterText: fc.string({ minLength: 0, maxLength: 200 }),
        }),
        (params) => {
          fc.pre(params.beforeText !== params.afterText);

          const correction = createTextCorrection(params);

          expect(correction).not.toBeNull();
          expect(correction!.beforeText).toBe(params.beforeText);
          expect(correction!.afterText).toBe(params.afterText);
          expect(correction!.correctionType).toBe('TEXT');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.10**
   *
   * For any (beforeSpeaker, afterSpeaker) pair where beforeSpeaker !== afterSpeaker,
   * createSpeakerCorrection returns a Correction containing both beforeSpeaker and afterSpeaker,
   * plus beforeText and afterText.
   */
  test('話者変更時、Correction に beforeSpeaker, afterSpeaker, beforeText, afterText が含まれる', () => {
    fc.assert(
      fc.property(
        fc.record({
          sessionId: fc.uuid(),
          segmentId: fc.uuid(),
          userId: fc.uuid(),
          beforeText: fc.string({ minLength: 0, maxLength: 200 }),
          afterText: fc.string({ minLength: 0, maxLength: 200 }),
          beforeSpeaker: fc.string({ minLength: 1, maxLength: 50 }),
          afterSpeaker: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        (params) => {
          fc.pre(params.beforeSpeaker !== params.afterSpeaker);

          const correction = createSpeakerCorrection(params);

          expect(correction).not.toBeNull();
          expect(correction!.beforeSpeaker).toBe(params.beforeSpeaker);
          expect(correction!.afterSpeaker).toBe(params.afterSpeaker);
          expect(correction!.beforeText).toBe(params.beforeText);
          expect(correction!.afterText).toBe(params.afterText);
          expect(correction!.correctionType).toBe('SPEAKER');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.15**
   *
   * For any speaker rename, createSpeakerRenameCorrection returns a Correction
   * containing beforeSpeaker, afterSpeaker, beforeText, afterText, and affectedSegmentCount.
   */
  test('話者ラベル一括変更時、Correction に beforeSpeaker, afterSpeaker, beforeText, afterText, affectedSegmentCount が含まれる', () => {
    fc.assert(
      fc.property(
        fc.record({
          sessionId: fc.uuid(),
          segmentId: fc.uuid(),
          userId: fc.uuid(),
          beforeText: fc.string({ minLength: 0, maxLength: 200 }),
          afterText: fc.string({ minLength: 0, maxLength: 200 }),
          beforeSpeaker: fc.string({ minLength: 1, maxLength: 50 }),
          afterSpeaker: fc.string({ minLength: 1, maxLength: 50 }),
          affectedSegmentCount: fc.integer({ min: 1, max: 1000 }),
        }),
        (params) => {
          const correction = createSpeakerRenameCorrection(params);

          expect(correction).not.toBeNull();
          expect(correction.beforeSpeaker).toBe(params.beforeSpeaker);
          expect(correction.afterSpeaker).toBe(params.afterSpeaker);
          expect(correction.beforeText).toBe(params.beforeText);
          expect(correction.afterText).toBe(params.afterText);
          expect(correction.affectedSegmentCount).toBe(params.affectedSegmentCount);
          expect(correction.correctionType).toBe('SPEAKER_RENAME');
        }
      ),
      { numRuns: 100 }
    );
  });
});
