/**
 * CIDR format validation utility.
 *
 * Validates IPv4 and IPv6 CIDR notation and checks IP membership in CIDR ranges.
 */

/**
 * Validates whether a string is a valid CIDR notation (IPv4 or IPv6).
 *
 * Valid formats:
 * - IPv4: x.x.x.x/n where each octet is 0-255 and n is 0-32
 * - IPv6: valid IPv6 address/n where n is 0-128
 */
export function validateCIDR(cidr: string): boolean {
  if (typeof cidr !== 'string' || cidr.trim() === '') {
    return false;
  }

  const trimmed = cidr.trim();
  const slashIndex = trimmed.lastIndexOf('/');

  if (slashIndex === -1) {
    return false;
  }

  const addressPart = trimmed.substring(0, slashIndex);
  const prefixPart = trimmed.substring(slashIndex + 1);

  if (prefixPart === '' || !/^\d+$/.test(prefixPart)) {
    return false;
  }

  const prefixLength = parseInt(prefixPart, 10);

  // Try IPv4 first
  if (isValidIPv4(addressPart)) {
    return prefixLength >= 0 && prefixLength <= 32;
  }

  // Try IPv6
  if (isValidIPv6(addressPart)) {
    return prefixLength >= 0 && prefixLength <= 128;
  }

  return false;
}

/**
 * Checks if an IP address is within any of the given CIDR ranges.
 *
 * When cidrList is empty, returns true (no restriction).
 */
export function isIPAllowed(ip: string, cidrList: string[]): boolean {
  if (cidrList.length === 0) {
    return true;
  }

  const trimmedIp = ip.trim();

  for (const cidr of cidrList) {
    if (ipMatchesCIDR(trimmedIp, cidr.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a single IP matches a single CIDR range.
 */
function ipMatchesCIDR(ip: string, cidr: string): boolean {
  const slashIndex = cidr.lastIndexOf('/');
  if (slashIndex === -1) return false;

  const networkAddress = cidr.substring(0, slashIndex);
  const prefixLength = parseInt(cidr.substring(slashIndex + 1), 10);

  // IPv4
  if (isValidIPv4(ip) && isValidIPv4(networkAddress)) {
    const ipBits = ipv4ToBits(ip);
    const networkBits = ipv4ToBits(networkAddress);
    if (ipBits === null || networkBits === null) return false;
    return matchesBits(ipBits, networkBits, prefixLength);
  }

  // IPv6
  if (isValidIPv6(ip) && isValidIPv6(networkAddress)) {
    const ipBits = ipv6ToBits(ip);
    const networkBits = ipv6ToBits(networkAddress);
    if (ipBits === null || networkBits === null) return false;
    return matchesBits(ipBits, networkBits, prefixLength);
  }

  return false;
}

/**
 * Validates an IPv4 address string.
 */
function isValidIPv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    if (part === '' || !/^\d+$/.test(part)) return false;
    // Reject leading zeros (e.g., "01", "001")
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = parseInt(part, 10);
    if (num < 0 || num > 255) return false;
  }

  return true;
}

/**
 * Validates an IPv6 address string.
 * Supports full form, compressed (::) form, and mixed IPv4 notation.
 */
function isValidIPv6(address: string): boolean {
  if (address === '') return false;

  // Handle :: expansion
  const doubleColonCount = (address.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;

  // Split by ::
  if (address.includes('::')) {
    const [left, right] = address.split('::');
    const leftGroups = left === '' ? [] : left.split(':');
    const rightGroups = right === '' ? [] : right.split(':');

    const totalGroups = leftGroups.length + rightGroups.length;
    if (totalGroups > 7) return false;

    for (const group of [...leftGroups, ...rightGroups]) {
      if (!isValidIPv6Group(group)) return false;
    }

    return true;
  }

  // Full form: exactly 8 groups
  const groups = address.split(':');
  if (groups.length !== 8) return false;

  for (const group of groups) {
    if (!isValidIPv6Group(group)) return false;
  }

  return true;
}

/**
 * Validates a single IPv6 group (1-4 hex digits).
 */
function isValidIPv6Group(group: string): boolean {
  if (group === '' || group.length > 4) return false;
  return /^[0-9a-fA-F]{1,4}$/.test(group);
}

/**
 * Converts an IPv4 address to a 32-element bit array.
 */
function ipv4ToBits(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  const bits: number[] = [];
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    for (let i = 7; i >= 0; i--) {
      bits.push((num >> i) & 1);
    }
  }

  return bits;
}

/**
 * Converts an IPv6 address to a 128-element bit array.
 */
function ipv6ToBits(address: string): number[] | null {
  const expanded = expandIPv6(address);
  if (!expanded) return null;

  const groups = expanded.split(':');
  if (groups.length !== 8) return null;

  const bits: number[] = [];
  for (const group of groups) {
    const num = parseInt(group, 16);
    if (isNaN(num)) return null;
    for (let i = 15; i >= 0; i--) {
      bits.push((num >> i) & 1);
    }
  }

  return bits;
}

/**
 * Expands a compressed IPv6 address to full form.
 */
function expandIPv6(address: string): string | null {
  if (address.includes('::')) {
    const [left, right] = address.split('::');
    const leftGroups = left === '' ? [] : left.split(':');
    const rightGroups = right === '' ? [] : right.split(':');
    const missingGroups = 8 - leftGroups.length - rightGroups.length;

    if (missingGroups < 0) return null;

    const allGroups = [
      ...leftGroups,
      ...Array(missingGroups).fill('0'),
      ...rightGroups,
    ];

    return allGroups.map((g) => g.padStart(4, '0')).join(':');
  }

  const groups = address.split(':');
  if (groups.length !== 8) return null;

  return groups.map((g) => g.padStart(4, '0')).join(':');
}

/**
 * Compares two bit arrays up to the given prefix length.
 */
function matchesBits(
  ipBits: number[],
  networkBits: number[],
  prefixLength: number
): boolean {
  for (let i = 0; i < prefixLength; i++) {
    if (ipBits[i] !== networkBits[i]) {
      return false;
    }
  }
  return true;
}
