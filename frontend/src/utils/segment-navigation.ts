import type { Segment } from '../types/segment';

/**
 * セグメント移動（キーボードカーソル）の算出ロジック。
 *
 * すべて純関数として実装し、ReviewPage の focusedSegmentId 遷移に使う。
 * 入力は表示順（sortSegmentsByTimestamp 済み）に並んだ配列を前提とする。
 */

export interface SegmentNavigationOptions {
  /** 未校閲セグメントのみを移動対象にする（修正済み/CONFIRMED を飛ばす） */
  uncorrectedOnly?: boolean;
  /** 修正済みとみなす segmentId の集合（appliedText 由来） */
  correctedIds?: Set<string>;
}

/**
 * セグメントが「校閲済み（移動対象から除外すべき）」かどうかを判定する。
 * - correctedIds に含まれる、または consensusStatus === 'CONFIRMED' を校閲済みとみなす。
 */
export function isSegmentReviewed(
  segment: Segment,
  correctedIds?: Set<string>
): boolean {
  if (segment.consensusStatus === 'CONFIRMED') {
    return true;
  }
  return correctedIds?.has(segment.segmentId) ?? false;
}

/**
 * 移動対象となるセグメントの配列を返す。
 * uncorrectedOnly が true の場合は未校閲のみに絞り込む。
 */
function getNavigableSegments(
  segments: Segment[],
  options: SegmentNavigationOptions
): Segment[] {
  if (!options.uncorrectedOnly) {
    return segments;
  }
  return segments.filter((s) => !isSegmentReviewed(s, options.correctedIds));
}

/**
 * 現在のフォーカス位置から「次」のセグメント ID を返す。
 *
 * - currentId が null/未知の場合は移動対象の先頭を返す。
 * - 末尾にいる場合は現在値を維持（currentId）。
 * - 移動対象が空の場合は null を返す。
 *
 * @param segments  表示順にソート済みのセグメント配列
 * @param currentId 現在のフォーカス segmentId（null 可）
 * @param options   未校閲のみ移動などのオプション
 */
export function getNextSegmentId(
  segments: Segment[],
  currentId: string | null,
  options: SegmentNavigationOptions = {}
): string | null {
  const navigable = getNavigableSegments(segments, options);
  if (navigable.length === 0) {
    return null;
  }

  // currentId が移動対象に存在しない（null / 校閲済みで除外された等）場合は先頭へ。
  const index = navigable.findIndex((s) => s.segmentId === currentId);
  if (index === -1) {
    return navigable[0].segmentId;
  }

  // 末尾の場合は現在値を維持する。
  if (index >= navigable.length - 1) {
    return navigable[index].segmentId;
  }

  return navigable[index + 1].segmentId;
}

/**
 * 現在のフォーカス位置から「前」のセグメント ID を返す。
 *
 * - currentId が null/未知の場合は移動対象の末尾を返す。
 * - 先頭にいる場合は現在値を維持（currentId）。
 * - 移動対象が空の場合は null を返す。
 */
export function getPreviousSegmentId(
  segments: Segment[],
  currentId: string | null,
  options: SegmentNavigationOptions = {}
): string | null {
  const navigable = getNavigableSegments(segments, options);
  if (navigable.length === 0) {
    return null;
  }

  const index = navigable.findIndex((s) => s.segmentId === currentId);
  if (index === -1) {
    return navigable[navigable.length - 1].segmentId;
  }

  // 先頭の場合は現在値を維持する。
  if (index <= 0) {
    return navigable[index].segmentId;
  }

  return navigable[index - 1].segmentId;
}
