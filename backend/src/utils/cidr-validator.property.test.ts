import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isIPAllowed, validateCIDR } from './cidr-validator.js';

describe('Feature: transcription-review-app, Property 18: IPAllowlistによるアクセス制御', () => {
  /**
   * **Validates: Requirements 14.5**
   *
   * - When IPAllowlist has 1+ entries, only IPs matching the allowlist CIDRs are permitted
   * - When IPAllowlist has 0 entries, all IPs are permitted (no restriction)
   * - fail-closed: when WAF check mechanism fails, requests are rejected
   */

  // Arbitrary to generate a valid IPv4 octet (0-255)
  const octetArb = fc.integer({ min: 0, max: 255 });

  // Generate a valid IPv4 address as a string
  const ipv4Arb = fc.tuple(octetArb, octetArb, octetArb, octetArb).map(
    ([a, b, c, d]) => `${a}.${b}.${c}.${d}`
  );

  // Generate a /24 CIDR from the first 3 octets
  const cidr24Arb = fc.tuple(octetArb, octetArb, octetArb).map(
    ([a, b, c]) => `${a}.${b}.${c}.0/24`
  );

  it('an IP within a /24 CIDR is allowed (returns true)', () => {
    fc.assert(
      fc.property(
        // Generate first 3 octets for the network
        octetArb,
        octetArb,
        octetArb,
        // Generate the host part (last octet)
        octetArb,
        // Generate additional CIDRs that may or may not match
        fc.array(cidr24Arb, { minLength: 0, maxLength: 5 }),
        (a, b, c, hostOctet, extraCidrs) => {
          const ip = `${a}.${b}.${c}.${hostOctet}`;
          const matchingCidr = `${a}.${b}.${c}.0/24`;
          // The CIDR list includes the matching CIDR plus extras
          const cidrList = [matchingCidr, ...extraCidrs];

          const result = isIPAllowed(ip, cidrList);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('an IP NOT within any /24 CIDR is denied (returns false)', () => {
    fc.assert(
      fc.property(
        // Generate a network for the IP (first 3 octets)
        octetArb,
        octetArb,
        octetArb,
        // Host octet for the IP
        octetArb,
        // Generate CIDRs that definitely do NOT match the IP's network
        fc.array(
          fc.tuple(octetArb, octetArb, octetArb).filter(
            // We'll filter in the property body instead
            () => true
          ),
          { minLength: 1, maxLength: 5 }
        ),
        (a, b, c, hostOctet, cidrNetworks) => {
          const ip = `${a}.${b}.${c}.${hostOctet}`;

          // Build CIDR list ensuring none match the IP's /24 network
          const cidrList = cidrNetworks
            .map(([x, y, z]) => `${x}.${y}.${z}.0/24`)
            .filter((cidr) => {
              // Exclude any CIDR that shares the same first 3 octets as the IP
              const networkPart = cidr.split('.').slice(0, 3).join('.');
              return networkPart !== `${a}.${b}.${c}`;
            });

          // Only test when we have at least 1 non-matching CIDR
          fc.pre(cidrList.length >= 1);

          const result = isIPAllowed(ip, cidrList);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('when IPAllowlist has 0 entries, all IPs are permitted (no restriction)', () => {
    fc.assert(
      fc.property(
        ipv4Arb,
        (ip) => {
          // Empty CIDR list means no IP restriction is applied
          const result = isIPAllowed(ip, []);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('fail-closed: when isIPAllowed receives a non-empty list, IPs outside all CIDRs are always rejected', () => {
    fc.assert(
      fc.property(
        // Generate a random IP
        ipv4Arb,
        // Generate a non-empty CIDR list with a specific /32 that does NOT match the IP
        fc.tuple(octetArb, octetArb, octetArb, octetArb),
        (ip, [ca, cb, cc, cd]) => {
          const cidr = `${ca}.${cb}.${cc}.${cd}/32`;
          // Ensure the CIDR does not match the IP (different address)
          fc.pre(ip !== `${ca}.${cb}.${cc}.${cd}`);

          // With a non-empty allowlist, non-matching IPs are always denied (fail-closed)
          const result = isIPAllowed(ip, [cidr]);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: transcription-review-app, Property 19: CIDRバリデーション', () => {
  /**
   * **Validates: Requirements 14.15**
   *
   * For any valid IPv4 CIDR (x.x.x.x/n where x is 0-255 and n is 0-32),
   * validateCIDR returns true.
   */
  it('returns true for any valid IPv4 CIDR notation', () => {
    const validIPv4CIDR = fc
      .tuple(
        fc.nat({ max: 255 }),
        fc.nat({ max: 255 }),
        fc.nat({ max: 255 }),
        fc.nat({ max: 255 }),
        fc.nat({ max: 32 })
      )
      .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`);

    fc.assert(
      fc.property(validIPv4CIDR, (cidr) => {
        expect(validateCIDR(cidr)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.15**
   *
   * For any valid IPv6 CIDR (valid IPv6 address/n where n is 0-128),
   * validateCIDR returns true.
   */
  it('returns true for any valid IPv6 CIDR notation', () => {
    const validIPv6CIDR = fc
      .tuple(
        fc.array(fc.hexaString({ minLength: 1, maxLength: 4 }), {
          minLength: 8,
          maxLength: 8,
        }),
        fc.nat({ max: 128 })
      )
      .map(([groups, prefix]) => `${groups.join(':')}/${prefix}`);

    fc.assert(
      fc.property(validIPv6CIDR, (cidr) => {
        expect(validateCIDR(cidr)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.15**
   *
   * Edge cases: /0, /32 for IPv4 and /0, /128 for IPv6 prefix lengths
   * are all valid and accepted by validateCIDR.
   */
  it('accepts edge case prefix lengths: /0, /32 for IPv4 and /0, /128 for IPv6', () => {
    const ipv4WithEdgePrefixes = fc
      .tuple(
        fc.nat({ max: 255 }),
        fc.nat({ max: 255 }),
        fc.nat({ max: 255 }),
        fc.nat({ max: 255 }),
        fc.constantFrom(0, 32)
      )
      .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`);

    const ipv6WithEdgePrefixes = fc
      .tuple(
        fc.array(fc.hexaString({ minLength: 1, maxLength: 4 }), {
          minLength: 8,
          maxLength: 8,
        }),
        fc.constantFrom(0, 128)
      )
      .map(([groups, prefix]) => `${groups.join(':')}/${prefix}`);

    fc.assert(
      fc.property(
        fc.oneof(ipv4WithEdgePrefixes, ipv6WithEdgePrefixes),
        (cidr) => {
          expect(validateCIDR(cidr)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.15**
   *
   * For any string that is NOT a valid CIDR format, validateCIDR returns false.
   */
  it('returns false for strings that are not valid CIDR format', () => {
    const invalidCIDR = fc.oneof(
      // No slash at all
      fc.string().filter((s) => !s.includes('/')),
      // Prefix out of range for IPv4-like strings
      fc
        .tuple(
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.integer({ min: 33, max: 128 })
        )
        .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`),
      // Octets out of range
      fc
        .tuple(
          fc.integer({ min: 256, max: 999 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 32 })
        )
        .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`),
      // Empty string
      fc.constant(''),
      // Only slash
      fc.constant('/'),
      // Missing prefix
      fc
        .tuple(
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 })
        )
        .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}/`),
      // Non-numeric prefix
      fc
        .tuple(
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.string({ minLength: 1 }).filter((s) => !/^\d+$/.test(s))
        )
        .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`),
      // Too few octets
      fc
        .tuple(fc.nat({ max: 255 }), fc.nat({ max: 255 }), fc.nat({ max: 32 }))
        .map(([a, b, prefix]) => `${a}.${b}/${prefix}`),
      // Leading zeros in octets
      fc
        .tuple(
          fc.nat({ max: 9 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.nat({ max: 32 })
        )
        .map(([a, b, c, d, prefix]) => `0${a}.${b}.${c}.${d}/${prefix}`)
        .filter((s) => {
          const firstOctet = s.split('.')[0];
          return firstOctet.length > 1 && firstOctet.startsWith('0');
        })
    );

    fc.assert(
      fc.property(invalidCIDR, (input) => {
        expect(validateCIDR(input)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
