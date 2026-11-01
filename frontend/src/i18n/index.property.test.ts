import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
} from './index';

/**
 * 言語決定の補助関数。normalizeLanguage が null（サポート外）を返した場合は
 * 既定言語(ja)にフォールバックする、という優先順位ロジックを表す。
 */
function resolveLanguage(value: string | null | undefined): string {
  return normalizeLanguage(value) ?? DEFAULT_LANGUAGE;
}

describe('Feature: i18n language detection, Property 1: サポート外言語は既定(ja)にフォールバックする', () => {
  /**
   * **Validates: Requirements 2 (対応言語), 3 (言語決定優先順位)**
   * supportedLngs に含まれない任意の文字列を解決すると、必ず既定言語になる。
   */
  it('サポート外の任意文字列は DEFAULT_LANGUAGE に解決される', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => normalizeLanguage(s) === null),
        (arbitrary) => {
          expect(resolveLanguage(arbitrary)).toBe(DEFAULT_LANGUAGE);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: i18n language detection, Property 2: サポート言語は常に自分自身へ解決する', () => {
  /**
   * **Validates: Requirements 2 (対応言語)**
   * サポート言語（地域サブタグ付きを含む）は必ずそのサポート言語に解決される。
   */
  it('サポート言語は地域サブタグの有無にかかわらず自分自身へ解決される', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        fc.option(fc.constantFrom('US', 'JP', 'GB', 'CA'), { nil: undefined }),
        (lang, region) => {
          const input = region ? `${lang}-${region}` : lang;
          expect(resolveLanguage(input)).toBe(lang);
        }
      ),
      { numRuns: 100 }
    );
  });
});
