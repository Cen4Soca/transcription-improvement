import type { Segment } from '../types/segment';

/**
 * Sort segments by startTime in ascending order.
 * Returns a new array without mutating the input.
 */
export function sortSegmentsByTimestamp(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.startTime - b.startTime);
}

/**
 * Convert seconds to HH:MM:SS format string.
 * Truncates to integer seconds for display.
 */
export function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  return `${hh}:${mm}:${ss}`;
}

/**
 * Convert HH:MM:SS format string back to seconds (integer).
 */
export function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);

  return hours * 3600 + minutes * 60 + seconds;
}
