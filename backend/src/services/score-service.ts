/**
 * ContributorScore calculation service.
 *
 * Pure function `calculateScore()` computes the contributor score
 * from answer count and accuracy rate.
 *
 * Score formula: answerCount × accuracyRate / 100
 */

export type ScorePeriod = 'ALL' | 'THIS_MONTH' | 'THIS_YEAR' | 'LAST_30_DAYS' | 'LAST_90_DAYS';

export interface ContributorScoreRecord {
  userId: string;
  displayName: string;
  period: ScorePeriod;
  answerCount: number;
  accuracyRate: number;
  score: number;
  updatedAt: string;
}

/**
 * Calculate ContributorScore from answer count and accuracy rate.
 *
 * Formula: answerCount × accuracyRate / 100
 *
 * This is a pure function with no side effects.
 *
 * @param answerCount - Number of answers for confirmed consensus segments (non-negative integer)
 * @param accuracyRate - Percentage of correct answers (0.0 - 100.0)
 * @returns The calculated score
 */
export function calculateScore(answerCount: number, accuracyRate: number): number {
  return (answerCount * accuracyRate) / 100;
}

/**
 * Determine the start date for a given period.
 *
 * @param period - The aggregation period
 * @param now - The current date (for testability)
 * @returns The start date for the period, or null for ALL (no lower bound)
 */
export function getPeriodStartDate(period: ScorePeriod, now: Date = new Date()): Date | null {
  switch (period) {
    case 'ALL':
      return null;
    case 'THIS_MONTH': {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    }
    case 'THIS_YEAR': {
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    }
    case 'LAST_30_DAYS': {
      const start = new Date(now.getTime());
      start.setUTCDate(start.getUTCDate() - 30);
      start.setUTCHours(0, 0, 0, 0);
      return start;
    }
    case 'LAST_90_DAYS': {
      const start = new Date(now.getTime());
      start.setUTCDate(start.getUTCDate() - 90);
      start.setUTCHours(0, 0, 0, 0);
      return start;
    }
  }
}

/**
 * Generate an inverted score string for DynamoDB sort key.
 * This allows descending sort order using DynamoDB's ascending sort.
 *
 * Score is padded to 10 digits with 4 decimal places.
 * Inverted = 9999999999.9999 - score
 *
 * @param score - The score to invert
 * @returns Zero-padded inverted score string
 */
export function invertScoreForSortKey(score: number): string {
  const inverted = 9999999999.9999 - score;
  const intPart = Math.floor(inverted);
  const decPart = Math.round((inverted - intPart) * 10000);
  return `${intPart.toString().padStart(10, '0')}.${decPart.toString().padStart(4, '0')}`;
}

/**
 * Sort an array of ContributorScore entries by ranking order.
 *
 * Ranking sort logic:
 * 1. score descending (higher score = higher rank)
 * 2. answerCount descending as tiebreaker (higher answerCount = higher rank when scores are equal)
 *
 * This is a pure function that returns a new sorted array without mutating the input.
 *
 * @param entries - Array of ContributorScore entries with score and answerCount
 * @returns A new array sorted by ranking order
 */
export function sortRanking(entries: Array<{ score: number; answerCount: number }>): Array<{ score: number; answerCount: number }> {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.answerCount - a.answerCount;
  });
}

/**
 * All supported score periods for iteration.
 */
export const ALL_PERIODS: ScorePeriod[] = [
  'ALL',
  'THIS_MONTH',
  'THIS_YEAR',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
];
