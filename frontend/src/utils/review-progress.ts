import type { Segment } from '../types/segment';
import { isSegmentReviewed } from './segment-navigation';

/**
 * 校閲進捗の算出結果。
 */
export interface ReviewProgress {
  /** 全セグメント数 */
  total: number;
  /** 校閲済み（修正済み or CONFIRMED）のセグメント数 */
  done: number;
  /** 進捗率（0〜1）。total が 0 のときは 0 */
  ratio: number;
}

/**
 * 校閲進捗を算出する純関数。
 *
 * - 修正済み（correctedIds に含まれる）または CONFIRMED のセグメントを「校閲済み」とする。
 *   両条件を満たしても二重計上しない（isSegmentReviewed で一元判定）。
 * - ratio は 0〜1 にクランプされる（total=0 のときは 0）。
 *
 * @param segments     対象セグメント配列
 * @param correctedIds 修正済み segmentId の集合（appliedText 由来）
 */
export function computeReviewProgress(
  segments: Segment[],
  correctedIds?: Set<string>
): ReviewProgress {
  const total = segments.length;
  if (total === 0) {
    return { total: 0, done: 0, ratio: 0 };
  }

  let done = 0;
  for (const segment of segments) {
    if (isSegmentReviewed(segment, correctedIds)) {
      done += 1;
    }
  }

  return { total, done, ratio: done / total };
}
