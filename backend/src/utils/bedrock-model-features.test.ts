import { describe, it, expect } from 'vitest';
import {
  supportsTemperature,
  usesEffortControls,
  inferenceControlParams,
} from './bedrock-model-features.js';

// Model IDs verified against Bedrock (ap-northeast-1):
//   - Haiku 4.5 accepts `temperature`, rejects `output_config.effort`.
//   - Haiku 5.5 rejects `temperature`, accepts `output_config.effort`.
const HAIKU_45 = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
const HAIKU_55 = 'jp.anthropic.claude-haiku-5-5';

describe('usesEffortControls', () => {
  it('is true for a Claude 5.x model regardless of geo prefix', () => {
    expect(usesEffortControls(HAIKU_55)).toBe(true);
    expect(usesEffortControls('eu.anthropic.claude-haiku-5-5')).toBe(true);
    expect(usesEffortControls('anthropic.claude-haiku-5-5')).toBe(true);
    expect(usesEffortControls('eu.anthropic.claude-sonnet-5-5')).toBe(true);
    expect(usesEffortControls('anthropic.claude-opus-5-5')).toBe(true);
  });

  it('is false for Haiku 4.5 and other temperature-based models', () => {
    expect(usesEffortControls(HAIKU_45)).toBe(false);
    expect(usesEffortControls('anthropic.claude-3-haiku-20240307-v1:0')).toBe(false);
  });
});

describe('supportsTemperature', () => {
  it('is the inverse of usesEffortControls', () => {
    expect(supportsTemperature(HAIKU_45)).toBe(true);
    expect(supportsTemperature(HAIKU_55)).toBe(false);
  });
});

describe('inferenceControlParams', () => {
  it('returns { temperature: 0 } by default for a temperature-based model', () => {
    expect(inferenceControlParams(HAIKU_45)).toEqual({ temperature: 0 });
  });

  it('returns effort output_config (default low) for an effort-based model', () => {
    expect(inferenceControlParams(HAIKU_55)).toEqual({
      output_config: { effort: 'low' },
    });
  });

  it('never emits both controls at once (mutual exclusivity)', () => {
    const t = inferenceControlParams(HAIKU_45);
    const e = inferenceControlParams(HAIKU_55);
    expect('temperature' in t).toBe(true);
    expect('output_config' in t).toBe(false);
    expect('output_config' in e).toBe(true);
    expect('temperature' in e).toBe(false);
  });

  it('honors an overridden temperature for temperature-based models', () => {
    expect(inferenceControlParams(HAIKU_45, { temperature: 0.7 })).toEqual({
      temperature: 0.7,
    });
  });

  it('honors an overridden effort level for effort-based models', () => {
    expect(inferenceControlParams(HAIKU_55, { effort: 'medium' })).toEqual({
      output_config: { effort: 'medium' },
    });
  });

  it('ignores an effort override on a temperature-based model', () => {
    expect(inferenceControlParams(HAIKU_45, { effort: 'max' })).toEqual({
      temperature: 0,
    });
  });

  it('ignores a temperature override on an effort-based model', () => {
    expect(inferenceControlParams(HAIKU_55, { temperature: 0.9 })).toEqual({
      output_config: { effort: 'low' },
    });
  });
});
