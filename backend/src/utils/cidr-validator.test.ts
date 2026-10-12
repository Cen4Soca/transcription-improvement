import { describe, it, expect } from 'vitest';
import { validateCIDR, isIPAllowed } from './cidr-validator.js';

describe('validateCIDR', () => {
  describe('valid IPv4 CIDR', () => {
    it('accepts standard IPv4 CIDR', () => {
      expect(validateCIDR('192.168.1.0/24')).toBe(true);
    });

    it('accepts /0 prefix (all addresses)', () => {
      expect(validateCIDR('0.0.0.0/0')).toBe(true);
    });

    it('accepts /32 prefix (single host)', () => {
      expect(validateCIDR('10.0.0.1/32')).toBe(true);
    });

    it('accepts various valid CIDRs', () => {
      expect(validateCIDR('172.16.0.0/12')).toBe(true);
      expect(validateCIDR('203.0.113.0/24')).toBe(true);
      expect(validateCIDR('255.255.255.255/32')).toBe(true);
    });
  });

  describe('valid IPv6 CIDR', () => {
    it('accepts full IPv6 CIDR', () => {
      expect(validateCIDR('2001:0db8:0000:0000:0000:0000:0000:0000/32')).toBe(true);
    });

    it('accepts compressed IPv6 CIDR', () => {
      expect(validateCIDR('2001:db8::/32')).toBe(true);
    });

    it('accepts /0 prefix', () => {
      expect(validateCIDR('::/0')).toBe(true);
    });

    it('accepts /128 prefix (single host)', () => {
      expect(validateCIDR('::1/128')).toBe(true);
    });

    it('accepts various valid IPv6 CIDRs', () => {
      expect(validateCIDR('fe80::/10')).toBe(true);
      expect(validateCIDR('fc00::/7')).toBe(true);
    });
  });

  describe('invalid CIDR formats', () => {
    it('rejects empty string', () => {
      expect(validateCIDR('')).toBe(false);
    });

    it('rejects plain IP without prefix', () => {
      expect(validateCIDR('192.168.1.0')).toBe(false);
    });

    it('rejects IPv4 with prefix > 32', () => {
      expect(validateCIDR('192.168.1.0/33')).toBe(false);
    });

    it('rejects IPv6 with prefix > 128', () => {
      expect(validateCIDR('2001:db8::/129')).toBe(false);
    });

    it('rejects negative prefix', () => {
      expect(validateCIDR('192.168.1.0/-1')).toBe(false);
    });

    it('rejects non-numeric prefix', () => {
      expect(validateCIDR('192.168.1.0/abc')).toBe(false);
    });

    it('rejects IPv4 with octet > 255', () => {
      expect(validateCIDR('256.0.0.0/24')).toBe(false);
    });

    it('rejects IPv4 with leading zeros', () => {
      expect(validateCIDR('192.168.01.0/24')).toBe(false);
    });

    it('rejects random strings', () => {
      expect(validateCIDR('not-a-cidr')).toBe(false);
      expect(validateCIDR('hello/world')).toBe(false);
    });

    it('rejects missing prefix after slash', () => {
      expect(validateCIDR('192.168.1.0/')).toBe(false);
    });

    it('rejects IPv4 with too few octets', () => {
      expect(validateCIDR('192.168.1/24')).toBe(false);
    });

    it('rejects IPv4 with too many octets', () => {
      expect(validateCIDR('192.168.1.0.1/24')).toBe(false);
    });
  });
});

describe('isIPAllowed', () => {
  describe('empty CIDR list', () => {
    it('allows any IP when list is empty (Req 14.6)', () => {
      expect(isIPAllowed('192.168.1.1', [])).toBe(true);
      expect(isIPAllowed('10.0.0.1', [])).toBe(true);
    });
  });

  describe('IPv4 matching', () => {
    it('allows IP within CIDR range', () => {
      expect(isIPAllowed('192.168.1.100', ['192.168.1.0/24'])).toBe(true);
    });

    it('denies IP outside CIDR range', () => {
      expect(isIPAllowed('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
    });

    it('allows exact match with /32', () => {
      expect(isIPAllowed('10.0.0.1', ['10.0.0.1/32'])).toBe(true);
    });

    it('denies different IP with /32', () => {
      expect(isIPAllowed('10.0.0.2', ['10.0.0.1/32'])).toBe(false);
    });

    it('allows any IPv4 with /0', () => {
      expect(isIPAllowed('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
    });

    it('checks multiple CIDR ranges', () => {
      const cidrs = ['10.0.0.0/8', '172.16.0.0/12'];
      expect(isIPAllowed('10.1.2.3', cidrs)).toBe(true);
      expect(isIPAllowed('172.20.1.1', cidrs)).toBe(true);
      expect(isIPAllowed('192.168.1.1', cidrs)).toBe(false);
    });

    it('handles /16 subnet correctly', () => {
      expect(isIPAllowed('192.168.0.1', ['192.168.0.0/16'])).toBe(true);
      expect(isIPAllowed('192.168.255.255', ['192.168.0.0/16'])).toBe(true);
      expect(isIPAllowed('192.169.0.1', ['192.168.0.0/16'])).toBe(false);
    });
  });

  describe('IPv6 matching', () => {
    it('allows IP within IPv6 CIDR range', () => {
      expect(isIPAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    });

    it('denies IP outside IPv6 CIDR range', () => {
      expect(isIPAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    });

    it('allows exact match with /128', () => {
      expect(isIPAllowed('::1', ['::1/128'])).toBe(true);
    });

    it('denies different IP with /128', () => {
      expect(isIPAllowed('::2', ['::1/128'])).toBe(false);
    });
  });
});
