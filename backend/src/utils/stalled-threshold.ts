/** Default stalled threshold (days). Mirrors infra DEFAULT_STALLED_THRESHOLD_DAYS. */
export const DEFAULT_STALLED_THRESHOLD_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Read the stalled threshold (days) from the STALLED_THRESHOLD_DAYS env var.
 * The value is validated at `cdk synth` time; here an unset or invalid value
 * falls back to the default so the Lambda never runs with a nonsensical limit.
 */
export function getStalledThresholdDays(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env['STALLED_THRESHOLD_DAYS'];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_STALLED_THRESHOLD_DAYS;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1
    ? parsed
    : DEFAULT_STALLED_THRESHOLD_DAYS;
}

/**
 * Pure function: is the last activity at least `thresholdDays` days before `now`?
 * An unparsable timestamp is treated as not stalled (no basis for flagging it).
 */
export function isStalled(
  lastActivityAt: string,
  now: Date,
  thresholdDays: number
): boolean {
  const last = new Date(lastActivityAt).getTime();
  if (Number.isNaN(last)) {
    return false;
  }
  return now.getTime() - last >= thresholdDays * MS_PER_DAY;
}
