import { describe, it, expect } from 'vitest';
import {
  calculateScore,
  getPeriodStartDate,
  invertScoreForSortKey,
  ALL_PERIODS,
  type ScorePeriod,
} from './score-service.js';

describe('score-service', () => {
  describe('calculateScore', () => {
    it('should return 0 when answerCount is 0', () => {
      expect(calculateScore(0, 85.5)).toBe(0);
    });

    it('should return 0 when accuracyRate is 0', () => {
      expect(calculateScore(50, 0)).toBe(0);
    });

    it('should return 0 when both are 0', () => {
      expect(calculateScore(0, 0)).toBe(0);
    });

    it('should calculate score correctly for typical values', () => {
      // 100 answers × 80% accuracy = 80
      expect(calculateScore(100, 80)).toBe(80);
    });

    it('should calculate score correctly with 100% accuracy', () => {
      // 50 answers × 100% accuracy = 50
      expect(calculateScore(50, 100)).toBe(50);
    });

    it('should calculate score correctly with decimal accuracy rate', () => {
      // 10 answers × 75.5% accuracy = 7.55
      expect(calculateScore(10, 75.5)).toBe(7.55);
    });

    it('should handle single answer with full accuracy', () => {
      // 1 answer × 100% = 1
      expect(calculateScore(1, 100)).toBe(1);
    });

    it('should handle large answer count', () => {
      // 1000 answers × 95% = 950
      expect(calculateScore(1000, 95)).toBe(950);
    });

    it('should handle very small accuracy rate', () => {
      // 200 answers × 0.5% = 1
      expect(calculateScore(200, 0.5)).toBe(1);
    });

    it('should produce correct formula: answerCount × accuracyRate / 100', () => {
      const answerCount = 42;
      const accuracyRate = 66.7;
      const expected = (answerCount * accuracyRate) / 100;
      expect(calculateScore(answerCount, accuracyRate)).toBe(expected);
    });
  });

  describe('getPeriodStartDate', () => {
    const fixedNow = new Date('2024-06-15T10:30:00.000Z');

    it('should return null for ALL period', () => {
      expect(getPeriodStartDate('ALL', fixedNow)).toBeNull();
    });

    it('should return first day of current month for THIS_MONTH', () => {
      const result = getPeriodStartDate('THIS_MONTH', fixedNow);
      expect(result).toEqual(new Date('2024-06-01T00:00:00.000Z'));
    });

    it('should return first day of current year for THIS_YEAR', () => {
      const result = getPeriodStartDate('THIS_YEAR', fixedNow);
      expect(result).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    });

    it('should return 30 days ago for LAST_30_DAYS', () => {
      const result = getPeriodStartDate('LAST_30_DAYS', fixedNow);
      expect(result).toEqual(new Date('2024-05-16T00:00:00.000Z'));
    });

    it('should return 90 days ago for LAST_90_DAYS', () => {
      const result = getPeriodStartDate('LAST_90_DAYS', fixedNow);
      expect(result).toEqual(new Date('2024-03-17T00:00:00.000Z'));
    });

    it('should handle January for THIS_MONTH', () => {
      const jan = new Date('2024-01-20T15:00:00.000Z');
      const result = getPeriodStartDate('THIS_MONTH', jan);
      expect(result).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    });

    it('should handle year boundary for LAST_30_DAYS', () => {
      const earlyJan = new Date('2024-01-10T12:00:00.000Z');
      const result = getPeriodStartDate('LAST_30_DAYS', earlyJan);
      // 30 days before Jan 10 = Dec 11
      expect(result).toEqual(new Date('2023-12-11T00:00:00.000Z'));
    });
  });

  describe('invertScoreForSortKey', () => {
    it('should produce a string that sorts in descending score order', () => {
      const highScore = invertScoreForSortKey(950);
      const lowScore = invertScoreForSortKey(50);
      // Higher score should produce a smaller (earlier in sort) string
      expect(highScore < lowScore).toBe(true);
    });

    it('should handle zero score', () => {
      const result = invertScoreForSortKey(0);
      expect(result).toBe('9999999999.9999');
    });

    it('should handle decimal scores', () => {
      const score80 = invertScoreForSortKey(80.5);
      const score79 = invertScoreForSortKey(79.5);
      expect(score80 < score79).toBe(true);
    });

    it('should produce consistent length strings', () => {
      const results = [
        invertScoreForSortKey(0),
        invertScoreForSortKey(1),
        invertScoreForSortKey(100),
        invertScoreForSortKey(999.99),
      ];
      // All should have same length for consistent DynamoDB sorting
      const lengths = results.map((r) => r.length);
      expect(new Set(lengths).size).toBe(1);
    });
  });

  describe('ALL_PERIODS', () => {
    it('should contain all 5 periods', () => {
      expect(ALL_PERIODS).toHaveLength(5);
      expect(ALL_PERIODS).toContain('ALL');
      expect(ALL_PERIODS).toContain('THIS_MONTH');
      expect(ALL_PERIODS).toContain('THIS_YEAR');
      expect(ALL_PERIODS).toContain('LAST_30_DAYS');
      expect(ALL_PERIODS).toContain('LAST_90_DAYS');
    });
  });
});
