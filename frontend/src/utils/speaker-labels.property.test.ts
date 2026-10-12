import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { renameSpeakerLabel } from './speaker-labels';
import type { Segment } from '../types/segment';

const consensusStatusArb = fc.constantFrom(
  'UNDECIDED' as const,
  'CONFIRMED' as const,
  'CONFLICT' as const
);

const speakerLabelArb = fc.string({ minLength: 1, maxLength: 20 }).filter(
  (s) => s.trim().length > 0
);

const segmentArb = fc.record({
  segmentId: fc.uuid(),
  sessionId: fc.uuid(),
  startTime: fc.float({ min: 0, max: 7200, noNaN: true }),
  endTime: fc.float({ min: 0, max: 7200, noNaN: true }),
  originalText: fc.string({ minLength: 0, maxLength: 100 }),
  speakerLabel: fc.option(speakerLabelArb, { nil: undefined }),
  consensusStatus: consensusStatusArb,
  consensusText: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
}) as fc.Arbitrary<Segment>;

describe('Feature: transcription-review-app, Property 7: 話者ラベル一括置換の完全性', () => {
  /**
   * **Validates: Requirements 2.14**
   *
   * For any array of Segments and any rename operation (oldLabel → newLabel):
   * 1. After rename, no segment has the old label
   * 2. The count of segments with the new label equals the original count of
   *    segments with old label + original count with new label
   * 3. Segments with other labels are unchanged
   */
  test('oldLabel を持つすべての Segment が newLabel に置換され、それ以外は変更されない', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArb, { minLength: 0, maxLength: 50 }),
        speakerLabelArb,
        speakerLabelArb,
        (segments, oldLabel, newLabel) => {
          const originalOldCount = segments.filter(
            (s) => s.speakerLabel === oldLabel
          ).length;
          const originalNewCount = segments.filter(
            (s) => s.speakerLabel === newLabel
          ).length;

          const result = renameSpeakerLabel(segments, oldLabel, newLabel);

          // Output array has the same length as input
          expect(result).toHaveLength(segments.length);

          // Property 1: After rename, no segment has the old label
          const resultOldCount = result.filter(
            (s) => s.speakerLabel === oldLabel
          ).length;
          if (oldLabel !== newLabel) {
            expect(resultOldCount).toBe(0);
          }

          // Property 2: The count of segments with the new label equals
          // the original count with old label + original count with new label
          const resultNewCount = result.filter(
            (s) => s.speakerLabel === newLabel
          ).length;
          if (oldLabel !== newLabel) {
            expect(resultNewCount).toBe(originalOldCount + originalNewCount);
          } else {
            // When oldLabel === newLabel, counts remain the same
            expect(resultNewCount).toBe(originalOldCount);
          }

          // Property 3: Segments with other labels are unchanged
          for (let i = 0; i < segments.length; i++) {
            if (segments[i].speakerLabel !== oldLabel) {
              expect(result[i]).toEqual(segments[i]);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
