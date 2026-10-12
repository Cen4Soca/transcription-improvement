/**
 * Metadata Sanitizer
 *
 * Sanitizes AuditLog metadata to only allow specific keys
 * and truncates values to a maximum length.
 *
 * Allowed keys: resourceName, previousValue, newValue, count, reason
 * Values are converted to strings and truncated to 1000 characters.
 */

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'resourceName',
  'previousValue',
  'newValue',
  'count',
  'reason',
]);

const MAX_VALUE_LENGTH = 1000;

/**
 * Sanitize metadata for AuditLog storage.
 *
 * - Filters to only allowed keys (resourceName, previousValue, newValue, count, reason)
 * - Converts all values to strings
 * - Truncates values to max 1000 characters
 * - Returns undefined if input is undefined or results in empty object
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized: Record<string, string> = {};

  for (const key of Object.keys(metadata)) {
    if (!ALLOWED_KEYS.has(key)) {
      continue;
    }

    const value = metadata[key];
    const stringValue = String(value);
    sanitized[key] = stringValue.length > MAX_VALUE_LENGTH
      ? stringValue.slice(0, MAX_VALUE_LENGTH)
      : stringValue;
  }

  if (Object.keys(sanitized).length === 0) {
    return undefined;
  }

  return sanitized;
}
