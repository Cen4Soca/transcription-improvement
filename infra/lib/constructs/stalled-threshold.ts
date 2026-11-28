/** Default number of days without review activity before a session is "stalled". */
export const DEFAULT_STALLED_THRESHOLD_DAYS = 7;
export const MIN_STALLED_THRESHOLD_DAYS = 1;
export const MAX_STALLED_THRESHOLD_DAYS = 90;

/**
 * Resolve the cdk.json context `stalledThresholdDays` into a validated integer.
 *
 * - undefined / null / '' -> default (7)
 * - integer within [1, 90] -> that value (numeric strings are accepted)
 * - anything else -> throws, so a typo fails `cdk synth` instead of silently
 *   deploying an unintended threshold.
 */
export function resolveStalledThresholdDays(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_STALLED_THRESHOLD_DAYS;
  }

  // Only numbers and numeric strings are accepted (Number(true) === 1 must not pass).
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_STALLED_THRESHOLD_DAYS ||
    parsed > MAX_STALLED_THRESHOLD_DAYS
  ) {
    throw new Error(
      `Invalid cdk.json context "stalledThresholdDays": ${JSON.stringify(raw)}. ` +
        `Must be an integer between ${MIN_STALLED_THRESHOLD_DAYS} and ${MAX_STALLED_THRESHOLD_DAYS}.`
    );
  }
  return parsed;
}
