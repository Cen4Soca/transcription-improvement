import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitizeMetadata } from './metadata-sanitizer.js';

const ALLOWED_KEYS = ['resourceName', 'previousValue', 'newValue', 'count', 'reason'] as const;
const MAX_VALUE_LENGTH = 1000;

describe('Feature: metadata-sanitization, Property 46: メタデータフィールドのサニタイズ', () => {
  /**
   * **Validates: Requirements 14.22**
   * For any AuditLog metadata with arbitrary key-value pairs,
   * only allowed keys (resourceName, previousValue, newValue, count, reason) pass through,
   * disallowed keys are removed, all values are converted to string type,
   * and values are truncated to max 1000 characters.
   */

  const allowedKeyArb = fc.constantFrom(...ALLOWED_KEYS);
  const disallowedKeyArb = fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((k) => !(ALLOWED_KEYS as readonly string[]).includes(k));

  const arbitraryValue = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    fc.array(fc.integer(), { maxLength: 3 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.string({ maxLength: 10 })),
  );

  it('only allowed keys pass through the sanitizer', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.oneof(allowedKeyArb, disallowedKeyArb),
          arbitraryValue,
          { minKeys: 1, maxKeys: 10 },
        ),
        async (metadata) => {
          const result = sanitizeMetadata(metadata);

          if (result === undefined) {
            // If result is undefined, it means no allowed keys were present
            const hasAllowedKey = Object.keys(metadata).some((k) =>
              (ALLOWED_KEYS as readonly string[]).includes(k),
            );
            expect(hasAllowedKey).toBe(false);
            return;
          }

          // All keys in result must be allowed keys
          for (const key of Object.keys(result)) {
            expect((ALLOWED_KEYS as readonly string[]).includes(key)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('disallowed keys are removed from the output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          allowedEntries: fc.dictionary(allowedKeyArb, arbitraryValue, { minKeys: 1, maxKeys: 5 }),
          disallowedEntries: fc.dictionary(disallowedKeyArb, arbitraryValue, { minKeys: 1, maxKeys: 5 }),
        }),
        async ({ allowedEntries, disallowedEntries }) => {
          const metadata = { ...allowedEntries, ...disallowedEntries };
          const result = sanitizeMetadata(metadata);

          if (result === undefined) return;

          // No disallowed key should appear among the result's own keys.
          // Use Object.keys (own, enumerable) rather than toHaveProperty, which
          // walks the prototype chain and would false-positive on special keys
          // like "__proto__" or "constructor".
          const resultOwnKeys = Object.keys(result);
          for (const key of Object.keys(disallowedEntries)) {
            expect(resultOwnKeys).not.toContain(key);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all values are converted to string type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(allowedKeyArb, arbitraryValue, { minKeys: 1, maxKeys: 5 }),
        async (metadata) => {
          const result = sanitizeMetadata(metadata);

          if (result === undefined) return;

          for (const value of Object.values(result)) {
            expect(typeof value).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('values are truncated to max 1000 characters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          allowedKeyArb,
          fc.string({ minLength: 500, maxLength: 3000 }),
          { minKeys: 1, maxKeys: 5 },
        ),
        async (metadata) => {
          const result = sanitizeMetadata(metadata);

          if (result === undefined) return;

          for (const [key, value] of Object.entries(result)) {
            expect(value.length).toBeLessThanOrEqual(MAX_VALUE_LENGTH);

            // If original value was longer than 1000, it should be truncated to exactly 1000
            const originalStr = String(metadata[key]);
            if (originalStr.length > MAX_VALUE_LENGTH) {
              expect(value.length).toBe(MAX_VALUE_LENGTH);
              expect(value).toBe(originalStr.slice(0, MAX_VALUE_LENGTH));
            } else {
              expect(value).toBe(originalStr);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
