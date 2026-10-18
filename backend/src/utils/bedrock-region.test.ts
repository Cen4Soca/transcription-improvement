import { describe, it, expect } from 'vitest';
import { resolveBedrockRegion } from './bedrock-region.js';

describe('resolveBedrockRegion', () => {
  it('maps a JP inference profile to ap-northeast-1', () => {
    expect(resolveBedrockRegion('jp.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(
      'ap-northeast-1'
    );
  });

  it('maps an EU inference profile to eu-central-1', () => {
    expect(resolveBedrockRegion('eu.anthropic.claude-sonnet-5-5')).toBe('eu-central-1');
  });

  it('returns undefined for a bare foundation-model ID', () => {
    expect(resolveBedrockRegion('anthropic.claude-3-haiku-20240307-v1:0')).toBeUndefined();
  });

  it('returns undefined for an unsupported geographic prefix (global.)', () => {
    expect(resolveBedrockRegion('global.anthropic.claude-sonnet-5-5')).toBeUndefined();
  });

  it('returns undefined for an unsupported geographic prefix (us.)', () => {
    expect(resolveBedrockRegion('us.anthropic.claude-3-5-sonnet-20241022-v2:0')).toBeUndefined();
  });

  it('returns undefined for an unsupported geographic prefix (apac.)', () => {
    expect(resolveBedrockRegion('apac.anthropic.claude-3-haiku-20240307-v1:0')).toBeUndefined();
  });
});
