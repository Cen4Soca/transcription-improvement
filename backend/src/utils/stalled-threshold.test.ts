import { describe, it, expect } from 'vitest';
import {
  getStalledThresholdDays,
  isStalled,
  DEFAULT_STALLED_THRESHOLD_DAYS,
} from './stalled-threshold.js';

describe('getStalledThresholdDays', () => {
  it('returns the default when unset or blank', () => {
    expect(getStalledThresholdDays({})).toBe(DEFAULT_STALLED_THRESHOLD_DAYS);
    expect(getStalledThresholdDays({ STALLED_THRESHOLD_DAYS: ' ' })).toBe(
      DEFAULT_STALLED_THRESHOLD_DAYS
    );
  });

  it('parses a valid integer', () => {
    expect(getStalledThresholdDays({ STALLED_THRESHOLD_DAYS: '14' })).toBe(14);
  });

  it.each(['0', '-3', '1.5', 'abc'])('falls back to default for %s', (value) => {
    expect(getStalledThresholdDays({ STALLED_THRESHOLD_DAYS: value })).toBe(
      DEFAULT_STALLED_THRESHOLD_DAYS
    );
  });
});

describe('isStalled', () => {
  const now = new Date('2026-11-26T00:00:00.000Z');

  it('is true exactly at the threshold boundary', () => {
    expect(isStalled('2026-11-19T00:00:00.000Z', now, 7)).toBe(true);
  });

  it('is false just inside the threshold', () => {
    expect(isStalled('2026-11-19T00:00:00.001Z', now, 7)).toBe(false);
  });

  it('is false for an unparsable timestamp', () => {
    expect(isStalled('not-a-date', now, 7)).toBe(false);
  });
});
