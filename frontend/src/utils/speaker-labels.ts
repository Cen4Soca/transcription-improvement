import type { Segment } from '../types/segment';

/**
 * Get unique speaker labels from a list of segments.
 * Returns labels in the order they first appear.
 */
export function getUniqueSpeakerLabels(segments: Segment[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const segment of segments) {
    if (segment.speakerLabel && !seen.has(segment.speakerLabel)) {
      seen.add(segment.speakerLabel);
      labels.push(segment.speakerLabel);
    }
  }

  return labels;
}

/**
 * Bulk rename a speaker label across all segments.
 * Returns a new array with updated segments (does not mutate input).
 * Segments with the old label get the new label; others remain unchanged.
 */
export function renameSpeakerLabel(
  segments: Segment[],
  oldLabel: string,
  newLabel: string
): Segment[] {
  return segments.map((segment) => {
    if (segment.speakerLabel === oldLabel) {
      return { ...segment, speakerLabel: newLabel };
    }
    return segment;
  });
}

/**
 * Count the number of segments that have a specific speaker label.
 */
export function countSegmentsWithLabel(
  segments: Segment[],
  label: string
): number {
  return segments.filter((segment) => segment.speakerLabel === label).length;
}

/**
 * Merge the session's speaker-label master list with the labels derived from
 * its segments. Returns the union, with segment-derived labels first (in order
 * of first appearance), then any master labels not yet assigned to a segment.
 * Duplicates are removed while preserving order.
 */
export function mergeSpeakerLabels(
  segments: Segment[],
  masterLabels?: string[]
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const label of getUniqueSpeakerLabels(segments)) {
    if (!seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }

  for (const label of masterLabels ?? []) {
    if (label && !seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }

  return result;
}
