import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  DEFAULT_LANGUAGE,
  type SupportedLanguage,
} from '../i18n';

/**
 * 現在の有効言語を取得する。i18n の解決済み言語を
 * サポート言語に正規化し、未サポートなら既定(ja)に丸める。
 */
function resolveCurrentLanguage(raw: string): SupportedLanguage {
  return normalizeLanguage(raw) ?? DEFAULT_LANGUAGE;
}

export interface SetLanguageOptions {
  /**
   * 言語をユーザープロファイルへ永続化するコールバック。
   * ログイン時のみ呼び出し側から渡す（未ログイン時は undefined）。
   * localStorage への保存は本フックが常に行う。
   */
  persist?: (lng: SupportedLanguage) => void | Promise<void>;
}

export interface UseLanguageResult {
  /** 現在の有効言語（'ja' | 'en'）。 */
  language: SupportedLanguage;
  /**
   * 言語を切り替える。
   * - i18n の表示言語を変更する
   * - localStorage に保存する
   * - options.persist が渡された場合はプロファイルにも保存する
   */
  setLanguage: (lng: SupportedLanguage, options?: SetLanguageOptions) => void;
}

/**
 * useLanguage - 言語の取得・切替を一元化するフック。
 *
 * 言語決定の優先順位（プロファイル > localStorage > ブラウザ > ja）のうち、
 * localStorage とブラウザ検出は i18n 初期化が担い、本フックは手動切替時の
 * i18n 更新・localStorage 保存・（任意の）プロファイル保存を担当する。
 */
export function useLanguage(): UseLanguageResult {
  const { i18n } = useTranslation();

  const language = resolveCurrentLanguage(i18n.language);

  const setLanguage = useCallback(
    (lng: SupportedLanguage, options?: SetLanguageOptions) => {
      void i18n.changeLanguage(lng);
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
      } catch {
        // localStorage が使えない環境では無視する
      }
      // プロファイル保存は任意。失敗しても UI 言語切替は成立させる（握りつぶす）。
      if (options?.persist) {
        void Promise.resolve(options.persist(lng)).catch(() => {
          // プロファイル保存の失敗は致命的でないため無視する
        });
      }
    },
    [i18n]
  );

  return { language, setLanguage };
}
