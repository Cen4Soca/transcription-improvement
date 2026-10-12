import type { Segment } from '../types/segment';

/**
 * Search segments by keyword using case-insensitive partial match on originalText.
 * Returns segments whose originalText contains the keyword (case-insensitive).
 * Returns all segments when keyword is empty.
 *
 * Requirements: 6.1, 6.2
 */
export function searchSegments(segments: Segment[], keyword: string): Segment[] {
  if (keyword === '') {
    return segments;
  }

  const lowerKeyword = keyword.toLowerCase();
  return segments.filter((segment) =>
    segment.originalText.toLowerCase().includes(lowerKeyword)
  );
}

/**
 * Filter segments that have no corrections recorded.
 * Returns only segments whose segmentId is NOT in the correctedSegmentIds set.
 *
 * Requirements: 6.4
 */
export function filterUncorrectedSegments(
  segments: Segment[],
  correctedSegmentIds: Set<string>
): Segment[] {
  return segments.filter((segment) => !correctedSegmentIds.has(segment.segmentId));
}
