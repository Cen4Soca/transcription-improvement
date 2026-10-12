import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createTextCorrection,
  createSpeakerCorrection,
  createSpeakerRenameCorrection,
} from './correction-utils';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Feature: transcription-review-app, Property 6: 変更なし確定ではCorrectionを記録しない', () => {
  /**
   * **Validates: Requirements 2.6, 2.12**
   *
   * For any string S, createTextCorrection(sessionId, segmentId, userId, S, S) always returns null.
   * This ensures that confirming without text changes does not record a Correction.
   */
  it('同一テキストで確定した場合、createTextCorrection は null を返す', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 0, maxLength: 200 }),
        (sessionId, segmentId, userId, text) => {
          const result = createTextCorrection(sessionId, segmentId, userId, text, text);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6, 2.12**
   *
   * For any string S, createSpeakerCorrection(sessionId, segmentId, userId, S, S) always returns null.
   * This ensures that confirming without speaker changes does not record a Correction.
   */
  it('同一話者ラベルで確定した場合、createSpeakerCorrection は null を返す', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 0, maxLength: 50 }),
        (sessionId, segmentId, userId, speaker) => {
          const result = createSpeakerCorrection(sessionId, segmentId, userId, speaker, speaker);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6, 2.12**
   *
   * For any two DIFFERENT strings A and B, createTextCorrection returns non-null.
   * This is the converse: actual changes always produce a Correction.
   */
  it('異なるテキストで確定した場合、createTextCorrection は non-null を返す', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 200 }),
        (sessionId, segmentId, userId, textA, textB) => {
          fc.pre(textA !== textB);
          const result = createTextCorrection(sessionId, segmentId, userId, textA, textB);
          expect(result).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6, 2.12**
   *
   * For any two DIFFERENT strings A and B, createSpeakerCorrection returns non-null.
   * This is the converse: actual speaker changes always produce a Correction.
   */
  it('異なる話者ラベルで確定した場合、createSpeakerCorrection は non-null を返す', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (sessionId, segmentId, userId, speakerA, speakerB) => {
          fc.pre(speakerA !== speakerB);
          const result = createSpeakerCorrection(sessionId, segmentId, userId, speakerA, speakerB);
          expect(result).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: transcription-review-app, Property 5: Correctionの完全性（テキスト・話者）', () => {
  /**
   * **Validates: Requirements 2.3, 2.10, 2.15**
   *
   * For any text correction where beforeText !== afterText,
   * the result always contains both beforeText and afterText fields.
   * All corrections have a valid correctionId (UUID format) and createdAt (ISO 8601).
   */
  it('text correction always contains beforeText and afterText when text differs', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 200 }),
        (sessionId, segmentId, userId, beforeText, afterText) => {
          fc.pre(beforeText !== afterText);

          const result = createTextCorrection(sessionId, segmentId, userId, beforeText, afterText);

          expect(result).not.toBeNull();
          expect(result!.beforeText).toBe(beforeText);
          expect(result!.afterText).toBe(afterText);
          expect(result!.correctionId).toMatch(UUID_PATTERN);
          expect(result!.createdAt).toMatch(ISO_8601_PATTERN);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 2.10, 2.15**
   *
   * For any speaker correction where beforeSpeaker !== afterSpeaker,
   * the result always contains beforeText, afterText, beforeSpeaker, afterSpeaker.
   * All corrections have a valid correctionId (UUID format) and createdAt (ISO 8601).
   */
  it('speaker correction always contains beforeText, afterText, beforeSpeaker, afterSpeaker when speaker differs', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (sessionId, segmentId, userId, beforeSpeaker, afterSpeaker) => {
          fc.pre(beforeSpeaker !== afterSpeaker);

          const result = createSpeakerCorrection(sessionId, segmentId, userId, beforeSpeaker, afterSpeaker);

          expect(result).not.toBeNull();
          expect(result!.beforeText).toBeDefined();
          expect(result!.afterText).toBeDefined();
          expect(result!.beforeSpeaker).toBe(beforeSpeaker);
          expect(result!.afterSpeaker).toBe(afterSpeaker);
          expect(result!.correctionId).toMatch(UUID_PATTERN);
          expect(result!.createdAt).toMatch(ISO_8601_PATTERN);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 2.10, 2.15**
   *
   * For any speaker rename correction, the result always contains
   * beforeText, afterText, beforeSpeaker, afterSpeaker, and affectedSegmentCount.
   * All corrections have a valid correctionId (UUID format) and createdAt (ISO 8601).
   */
  it('speaker rename correction always contains beforeText, afterText, beforeSpeaker, afterSpeaker, and affectedSegmentCount', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.nat({ max: 1000 }),
        (sessionId, userId, beforeLabel, afterLabel, affectedSegmentCount) => {
          const result = createSpeakerRenameCorrection(sessionId, userId, beforeLabel, afterLabel, affectedSegmentCount);

          expect(result).not.toBeNull();
          expect(result.beforeText).toBeDefined();
          expect(result.afterText).toBeDefined();
          expect(result.beforeSpeaker).toBe(beforeLabel);
          expect(result.afterSpeaker).toBe(afterLabel);
          expect(result.affectedSegmentCount).toBe(affectedSegmentCount);
          expect(result.correctionId).toMatch(UUID_PATTERN);
          expect(result.createdAt).toMatch(ISO_8601_PATTERN);
        }
      ),
      { numRuns: 100 }
    );
  });
});
