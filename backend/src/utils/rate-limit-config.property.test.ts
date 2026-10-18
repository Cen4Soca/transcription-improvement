import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  RATE_LIMIT_CONFIG,
  getRateLimitRule,
  isRateLimitExceeded,
  getResetTimeSeconds,
} from './rate-limit-config.js';

describe('Feature: transcription-review-app, Property 36: レートリミットの適用', () => {
  /**
   * **Validates: Requirements 14.17**
   *
   * Authentication endpoints are limited to 5 requests/minute/IP.
   * General API endpoints are limited to 100 requests/minute/user.
   * Requests exceeding the rate limit are rejected (429).
   * Rate limits reset after the time window.
   */

  // Arbitrary for auth endpoint paths (starting with /auth)
  const authPathArb = fc.stringOf(fc.char(), { minLength: 0, maxLength: 50 }).map(
    (suffix) => `/auth${suffix}`
  );

  // Arbitrary for general API paths (not starting with /auth)
  const generalPathArb = fc.oneof(
    fc.constant('/sessions'),
    fc.constant('/ranking'),
    fc.constant('/admin/users'),
    fc.constant('/admin/teams'),
    fc.constant('/consensus/resolve'),
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 })
      .filter((s) => !s.toLowerCase().startsWith('/auth'))
      .map((s) => s.startsWith('/') ? s : `/${s}`)
  );

  it('authentication endpoints are limited to 5 requests/minute/IP', () => {
    fc.assert(
      fc.property(authPathArb, (path) => {
        const rule = getRateLimitRule(path);
        expect(rule.limitPerMinute).toBe(5);
        expect(rule.limitPerFiveMinutes).toBe(25);
        expect(rule.aggregateKeyType).toBe('IP');
      }),
      { numRuns: 100 }
    );
  });

  it('general API endpoints are limited to 100 requests/minute/user', () => {
    fc.assert(
      fc.property(generalPathArb, (path) => {
        const rule = getRateLimitRule(path);
        expect(rule.limitPerMinute).toBe(100);
        expect(rule.limitPerFiveMinutes).toBe(500);
      }),
      { numRuns: 100 }
    );
  });

  it('requests exceeding the rate limit are rejected with 429 status', () => {
    // For auth endpoints: any request count > 5 in 1 minute should be blocked
    fc.assert(
      fc.property(
        authPathArb,
        fc.integer({ min: 6, max: 10000 }),
        (path, requestCount) => {
          const rule = getRateLimitRule(path);
          const exceeded = isRateLimitExceeded(requestCount, 1, rule);
          expect(exceeded).toBe(true);
          expect(rule.blockedStatusCode).toBe(429);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('requests within the rate limit are allowed', () => {
    // For auth endpoints: request count <= 5 in 1 minute should be allowed
    fc.assert(
      fc.property(
        authPathArb,
        fc.integer({ min: 0, max: 5 }),
        (path, requestCount) => {
          const rule = getRateLimitRule(path);
          const exceeded = isRateLimitExceeded(requestCount, 1, rule);
          expect(exceeded).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('general API requests within limit are allowed, exceeding are blocked', () => {
    fc.assert(
      fc.property(
        generalPathArb,
        fc.integer({ min: 0, max: 200 }),
        (path, requestCount) => {
          const rule = getRateLimitRule(path);
          const exceeded = isRateLimitExceeded(requestCount, 1, rule);
          if (requestCount <= 100) {
            expect(exceeded).toBe(false);
          } else {
            expect(exceeded).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rate limits reset after the time window (5-minute WAF window)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (windowMinutes) => {
          const resetTime = getResetTimeSeconds(windowMinutes);
          // Reset time should be the window duration in seconds
          expect(resetTime).toBe(windowMinutes * 60);
          // Reset time should never exceed 5 minutes (300 seconds)
          expect(resetTime).toBeLessThanOrEqual(300);
          expect(resetTime).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('WAF 5-minute window limit is exactly 5x the per-minute limit', () => {
    expect(RATE_LIMIT_CONFIG.auth.limitPerFiveMinutes).toBe(
      RATE_LIMIT_CONFIG.auth.limitPerMinute * 5
    );
    expect(RATE_LIMIT_CONFIG.general.limitPerFiveMinutes).toBe(
      RATE_LIMIT_CONFIG.general.limitPerMinute * 5
    );
  });
});
