import { describe, it, expect } from 'vitest';
import {
  resolveStalledThresholdDays,
  DEFAULT_STALLED_THRESHOLD_DAYS,
} from '../lib/constructs/stalled-threshold';

describe('resolveStalledThresholdDays', () => {
  it('falls back to the default when unset', () => {
    expect(resolveStalledThresholdDays(undefined)).toBe(DEFAULT_STALLED_THRESHOLD_DAYS);
    expect(resolveStalledThresholdDays(null)).toBe(DEFAULT_STALLED_THRESHOLD_DAYS);
    expect(resolveStalledThresholdDays('')).toBe(DEFAULT_STALLED_THRESHOLD_DAYS);
  });

  it('accepts integers in range (including boundaries) and numeric strings', () => {
    expect(resolveStalledThresholdDays(1)).toBe(1);
    expect(resolveStalledThresholdDays(14)).toBe(14);
    expect(resolveStalledThresholdDays(90)).toBe(90);
    expect(resolveStalledThresholdDays('30')).toBe(30);
  });

  it.each([0, -1, 91, 1.5, 'abc', NaN, true, {}])('rejects invalid value %p', (value) => {
    expect(() => resolveStalledThresholdDays(value)).toThrow(/stalledThresholdDays/);
  });
});
