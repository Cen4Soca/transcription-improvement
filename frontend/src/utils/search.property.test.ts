import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { searchSegments } from './search';
import type { Segment } from '../types/segment';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 1,
    originalText: '',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 100 });

describe('Feature: transcription-review-app, Property 11: 検索の大文字・小文字を区別しない部分一致', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any keyword and segment text, if the text contains the keyword (case-insensitive),
   * searchSegments returns that segment.
   */
  it('returns a segment when its text contains the keyword (case-insensitive)', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString,
        fc.string({ maxLength: 50 }),
        fc.string({ maxLength: 50 }),
        (keyword, prefix, suffix) => {
          const text = prefix + keyword + suffix;
          const segment = makeSegment({ segmentId: 'match', originalText: text });
          const result = searchSegments([segment], keyword);
          expect(result).toContainEqual(segment);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * For any keyword and segment text, if the text does NOT contain the keyword (case-insensitive),
   * searchSegments does NOT return that segment.
   */
  it('does not return a segment when its text does not contain the keyword (case-insensitive)', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString,
        arbNonEmptyString,
        (keyword, text) => {
          fc.pre(!text.toLowerCase().includes(keyword.toLowerCase()));
          const segment = makeSegment({ segmentId: 'no-match', originalText: text });
          const result = searchSegments([segment], keyword);
          expect(result).not.toContainEqual(segment);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * searchSegments with empty keyword returns all segments.
   */
  it('returns all segments when keyword is empty', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 100 }), { minLength: 0, maxLength: 20 }),
        (texts) => {
          const segments = texts.map((text, i) =>
            makeSegment({ segmentId: `seg-${i}`, originalText: text })
          );
          const result = searchSegments(segments, '');
          expect(result).toHaveLength(segments.length);
          expect(result).toEqual(segments);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * The search is truly case-insensitive: searching "ABC" finds "abc" and vice versa.
   */
  it('is truly case-insensitive (searching upper finds lower and vice versa)', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString,
        fc.string({ maxLength: 50 }),
        fc.string({ maxLength: 50 }),
        (keyword, prefix, suffix) => {
          const text = prefix + keyword.toLowerCase() + suffix;
          const segment = makeSegment({ segmentId: 'case-test', originalText: text });

          const resultUpper = searchSegments([segment], keyword.toUpperCase());
          const resultLower = searchSegments([segment], keyword.toLowerCase());
          const resultOriginal = searchSegments([segment], keyword);

          expect(resultUpper).toContainEqual(segment);
          expect(resultLower).toContainEqual(segment);
          expect(resultOriginal).toContainEqual(segment);
        }
      ),
      { numRuns: 100 }
    );
  });
});
