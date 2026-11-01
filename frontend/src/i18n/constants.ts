/**
 * i18n 関連の定数と純粋ヘルパ。
 *
 * i18next の初期化（副作用）を伴わないため、テストセットアップなど
 * 初期化前に値を参照したい場所から安全に import できる。
 */

/**
 * サポートする言語コード。
 * 新しい言語を追加する場合はここと resources / locales を拡張する。
 */
export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 既定言語（フォールバック）。 */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ja';

/** localStorage に言語設定を保存するキー。 */
export const LANGUAGE_STORAGE_KEY = 'preferredLanguage';

/**
 * 与えられた値がサポート対象の言語かどうかを判定する。
 * `en-US` のような地域付きコードは先頭の言語サブタグで判定する。
 */
export function normalizeLanguage(value: string | null | undefined): SupportedLanguage | null {
  if (!value) {
    return null;
  }
  const base = value.toLowerCase().split('-')[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as SupportedLanguage)
    : null;
}
