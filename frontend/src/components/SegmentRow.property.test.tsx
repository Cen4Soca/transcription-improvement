import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import fc from 'fast-check';
import { SegmentRow } from './SegmentRow';
import type { Segment } from '../types/segment';

const consensusStatusArb = fc.constantFrom(
  'UNDECIDED' as const,
  'CONFIRMED' as const,
  'CONFLICT' as const
);

/**
 * Arbitrary that generates speakerLabel as either a string (possibly empty) or undefined.
 */
const speakerLabelArb = fc.oneof(
  fc.constant(undefined),
  fc.string({ minLength: 0, maxLength: 50 })
);

function buildSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 1,
    originalText: 'text',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('Feature: segment-display, Property 3: 話者ラベルの条件付き表示', () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * For any Segment, the speaker label element is rendered if and only if
   * speakerLabel is a non-empty string.
   */
  it('speaker label is displayed if and only if speakerLabel is a non-empty string', () => {
    fc.assert(
      fc.property(
        fc.record({
          segmentId: fc.uuid(),
          sessionId: fc.uuid(),
          startTime: fc.integer({ min: 0, max: 86399 }),
          endTime: fc.integer({ min: 0, max: 86399 }),
          originalText: fc.string({ minLength: 1, maxLength: 100 }),
          speakerLabel: speakerLabelArb,
          consensusStatus: consensusStatusArb,
        }),
        (segmentData) => {
          const segment = buildSegment(segmentData);

          const { container, unmount } = render(<SegmentRow segment={segment} />);
          const scope = within(container);

          const labelElement = scope.queryByLabelText('話者ラベル');
          const isNonEmptyString =
            typeof segmentData.speakerLabel === 'string' &&
            segmentData.speakerLabel.length > 0;

          if (isNonEmptyString) {
            expect(labelElement).toBeInTheDocument();
            expect(labelElement!.textContent).toBe(segmentData.speakerLabel);
          } else {
            expect(labelElement).not.toBeInTheDocument();
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
