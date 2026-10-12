/**
 * Rate limit configuration for the application.
 * These values correspond to the WAF v2 Rate-based Rules configured in CDK (infra).
 *
 * WAF uses a 5-minute evaluation window, so per-minute limits are multiplied by 5.
 */

export interface RateLimitRule {
  /** Maximum requests per minute */
  limitPerMinute: number;
  /** WAF 5-minute window limit (limitPerMinute * 5) */
  limitPerFiveMinutes: number;
  /** Aggregation key type */
  aggregateKeyType: 'IP' | 'USER';
  /** URL path pattern that this rule applies to */
  pathPattern: string;
  /** HTTP status code returned when rate limit is exceeded */
  blockedStatusCode: number;
}

export interface RateLimitConfig {
  auth: RateLimitRule;
  general: RateLimitRule;
}

/**
 * Rate limit configuration matching WAF v2 Rate-based Rules.
 * - Authentication endpoints: 5 requests/min per IP
 * - General API endpoints: 100 requests/min per user
 */
export const RATE_LIMIT_CONFIG: RateLimitConfig = {
  auth: {
    limitPerMinute: 5,
    limitPerFiveMinutes: 25,
    aggregateKeyType: 'IP',
    pathPattern: '/auth',
    blockedStatusCode: 429,
  },
  general: {
    limitPerMinute: 100,
    limitPerFiveMinutes: 500,
    aggregateKeyType: 'IP',
    pathPattern: '/',
    blockedStatusCode: 429,
  },
};

/**
 * Determines which rate limit rule applies to a given request path.
 * Authentication endpoints (starting with /auth) use the stricter auth limit.
 * All other endpoints use the general limit.
 */
export function getRateLimitRule(path: string): RateLimitRule {
  if (path.toLowerCase().startsWith('/auth')) {
    return RATE_LIMIT_CONFIG.auth;
  }
  return RATE_LIMIT_CONFIG.general;
}

/**
 * Checks if a request count exceeds the rate limit for the given time window.
 * @param requestCount - Number of requests made in the time window
 * @param windowMinutes - Time window in minutes (1 or 5)
 * @param rule - The rate limit rule to check against
 * @returns true if the request should be blocked (rate limit exceeded)
 */
export function isRateLimitExceeded(
  requestCount: number,
  windowMinutes: number,
  rule: RateLimitRule
): boolean {
  if (windowMinutes <= 0) {
    return false;
  }

  if (windowMinutes <= 1) {
    return requestCount > rule.limitPerMinute;
  }

  // For the 5-minute WAF window
  const scaledLimit = rule.limitPerMinute * Math.min(windowMinutes, 5);
  return requestCount > scaledLimit;
}

/**
 * Calculates the time (in seconds) until the rate limit window resets.
 * WAF uses a rolling 5-minute window.
 */
export function getResetTimeSeconds(windowMinutes: number): number {
  return Math.min(windowMinutes, 5) * 60;
}
