/**
 * Consensus aggregation service.
 *
 * Pure function `computeConsensus()` calculates whether a set of reviewer
 * corrections for a segment meets the consensus threshold.
 *
 * Also provides:
 * - `shouldTriggerPartialAggregation()` — determines if partial aggregation should fire
 * - `getProgressInfo()` — returns anonymized progress information for reviewers
 */

export interface ConsensusInput {
  corrections: Array<{ userId: string; afterText: string }>;
  threshold: number; // 1-100 percentage
  totalReviewers: number;
}

export interface ConsensusOutput {
  status: 'CONFIRMED' | 'CONFLICT';
  consensusText?: string;
  agreementCount: number;
  agreementRate: number; // percentage (0-100)
}

export interface PartialAggregationInput {
  completedCount: number;
  totalReviewers: number;
  partialAggregationEnabled: boolean;
}

export interface ProgressInfo {
  message: string;
  remainingCount?: number;
}

/**
 * Compute consensus from a set of corrections for a single segment.
 *
 * Algorithm:
 * 1. Count occurrences of each unique afterText
 * 2. Find the most common answer (ties broken by first occurrence)
 * 3. Calculate agreement rate = (count of most common / totalReviewers) * 100
 * 4. If rate >= threshold → CONFIRMED with consensus text
 * 5. If rate < threshold → CONFLICT
 *
 * This is a pure function with no side effects.
 */
export function computeConsensus(input: ConsensusInput): ConsensusOutput {
  const { corrections, threshold, totalReviewers } = input;

  if (corrections.length === 0) {
    return {
      status: 'CONFLICT',
      agreementCount: 0,
      agreementRate: 0,
    };
  }

  if (threshold < 1 || threshold > 100) {
    throw new Error('threshold は 1〜100 の範囲で指定してください。');
  }

  if (totalReviewers < 1) {
    throw new Error('totalReviewers は 1 以上である必要があります。');
  }

  // Count occurrences of each unique afterText
  const counts = new Map<string, number>();
  for (const correction of corrections) {
    const current = counts.get(correction.afterText) ?? 0;
    counts.set(correction.afterText, current + 1);
  }

  // Find the most common answer
  let maxCount = 0;
  let consensusText = '';
  for (const [text, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      consensusText = text;
    }
  }

  // Calculate agreement rate based on totalReviewers
  const agreementRate = (maxCount / totalReviewers) * 100;

  if (agreementRate >= threshold) {
    return {
      status: 'CONFIRMED',
      consensusText,
      agreementCount: maxCount,
      agreementRate,
    };
  }

  return {
    status: 'CONFLICT',
    agreementCount: maxCount,
    agreementRate,
  };
}

/**
 * Minimum number of reviewers required for the automatic consensus flow
 * (Business rule: consensus aggregation runs once at least 3 reviewers have
 * submitted corrections). ADMIN / TEAM_LEADER can force aggregation below this.
 */
export const MIN_REVIEWERS_FOR_AUTO_CONSENSUS = 3;

export interface SegmentCorrectionGroup {
  segmentId: string;
  corrections: Array<{ userId: string; afterText: string }>;
}

export interface SegmentAggregationResult {
  segmentId: string;
  status: 'CONFIRMED' | 'CONFLICT';
  consensusText?: string;
  agreementCount: number;
  agreementRate: number;
}

/**
 * Force-aggregate every segment of a session regardless of how many reviewers
 * have participated. Used by ADMIN / TEAM_LEADER to close out a session even
 * when fewer than the usual minimum number of reviewers have contributed.
 *
 * Consensus is computed against the actual number of participating reviewers
 * (`totalReviewers`), so agreement rates are meaningful even for a small pool.
 * Each segment is CONFIRMED when its top answer meets the threshold, otherwise
 * marked CONFLICT for manual resolution.
 *
 * This is a pure function with no side effects; the caller persists the results.
 *
 * @param segments      corrections grouped per segment
 * @param threshold     consensus threshold percentage (1-100)
 * @param totalReviewers number of reviewers participating in the session (>= 1)
 */
export function forceAggregateSegments(
  segments: SegmentCorrectionGroup[],
  threshold: number,
  totalReviewers: number
): SegmentAggregationResult[] {
  // Consensus needs at least one reviewer to divide by; guard defensively.
  const effectiveReviewers = Math.max(totalReviewers, 1);

  return segments.map((segment) => {
    const output = computeConsensus({
      corrections: segment.corrections,
      threshold,
      totalReviewers: effectiveReviewers,
    });

    return {
      segmentId: segment.segmentId,
      status: output.status,
      consensusText: output.consensusText,
      agreementCount: output.agreementCount,
      agreementRate: output.agreementRate,
    };
  });
}

/**
 * Determine if partial aggregation should be triggered.
 *
 * Partial aggregation fires when:
 * 1. partialAggregationEnabled is true (Admin setting)
 * 2. completedCount >= ceil(totalReviewers / 2) (majority threshold)
 * 3. Not all reviewers have completed yet (that's the full aggregation case)
 *
 * This is a pure function with no side effects.
 */
export function shouldTriggerPartialAggregation(
  input: PartialAggregationInput
): boolean {
  const { completedCount, totalReviewers, partialAggregationEnabled } = input;

  if (!partialAggregationEnabled) {
    return false;
  }

  if (totalReviewers < 1) {
    return false;
  }

  // Don't trigger partial if all reviewers have completed (that's full aggregation)
  if (completedCount >= totalReviewers) {
    return false;
  }

  const majorityThreshold = Math.ceil(totalReviewers / 2);
  return completedCount >= majorityThreshold;
}

/**
 * Get anonymized progress information for a reviewer.
 *
 * Privacy rules (Requirement 10.11):
 * - If totalReviewers >= 5: show "あと{remaining}人が回答待ち" (specific count)
 * - If totalReviewers < 5: show "まだ回答が集まっています" (generic message)
 *
 * This prevents individual identification when the reviewer pool is small.
 *
 * This is a pure function with no side effects.
 */
export function getProgressInfo(
  completedCount: number,
  totalReviewers: number
): ProgressInfo {
  if (totalReviewers >= 5) {
    const remaining = totalReviewers - completedCount;
    return {
      message: `あと${remaining}人が回答待ち`,
      remainingCount: remaining,
    };
  }

  return {
    message: 'まだ回答が集まっています',
  };
}
