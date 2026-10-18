import { describe, it, expect } from 'vitest';
import { sanitizeMetadata } from './metadata-sanitizer.js';

describe('sanitizeMetadata', () => {
  it('returns undefined for undefined input', () => {
    expect(sanitizeMetadata(undefined)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(sanitizeMetadata({})).toBeUndefined();
  });

  it('returns undefined when all keys are disallowed', () => {
    expect(sanitizeMetadata({ secret: 'value', password: '123' })).toBeUndefined();
  });

  it('passes allowed keys through', () => {
    const input = {
      resourceName: 'test-resource',
      previousValue: 'old',
      newValue: 'new',
      count: '5',
      reason: 'updated',
    };
    const result = sanitizeMetadata(input);
    expect(result).toEqual({
      resourceName: 'test-resource',
      previousValue: 'old',
      newValue: 'new',
      count: '5',
      reason: 'updated',
    });
  });

  it('removes disallowed keys', () => {
    const input = {
      resourceName: 'test',
      secretKey: 'should-be-removed',
      password: 'should-be-removed',
      reason: 'valid',
    };
    const result = sanitizeMetadata(input);
    expect(result).toEqual({
      resourceName: 'test',
      reason: 'valid',
    });
    expect(result).not.toHaveProperty('secretKey');
    expect(result).not.toHaveProperty('password');
  });

  it('converts non-string values to strings', () => {
    const input = {
      count: 42,
      resourceName: true,
      reason: null,
      newValue: { nested: 'object' },
    };
    const result = sanitizeMetadata(input as Record<string, unknown>);
    expect(result).toEqual({
      count: '42',
      resourceName: 'true',
      reason: 'null',
      newValue: '[object Object]',
    });
  });

  it('truncates values exceeding 1000 characters', () => {
    const longValue = 'a'.repeat(1500);
    const input = { resourceName: longValue };
    const result = sanitizeMetadata(input);
    expect(result!.resourceName).toHaveLength(1000);
    expect(result!.resourceName).toBe('a'.repeat(1000));
  });

  it('does not truncate values at exactly 1000 characters', () => {
    const exactValue = 'b'.repeat(1000);
    const input = { reason: exactValue };
    const result = sanitizeMetadata(input);
    expect(result!.reason).toHaveLength(1000);
    expect(result!.reason).toBe(exactValue);
  });

  it('does not truncate values under 1000 characters', () => {
    const shortValue = 'c'.repeat(999);
    const input = { previousValue: shortValue };
    const result = sanitizeMetadata(input);
    expect(result!.previousValue).toHaveLength(999);
  });
});
