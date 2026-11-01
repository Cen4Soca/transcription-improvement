// localStorage ポリフィルを最初に読み込む（i18n 初期化より前である必要がある）。
import './test-utils/local-storage-polyfill';
// テストのデフォルト言語を ja に固定する。jsdom の navigator.language は 'en-US' のため、
// localStorage を先にセットしておかないと i18n が初回検出で en を選んでしまう。
// 既存テストは日本語表示を期待しているため、ここで ja を固定する。
import { LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE } from './i18n/constants';
window.localStorage.setItem(LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE);

import '@testing-library/jest-dom/vitest';
import * as matchers from 'vitest-axe/matchers';
import { expect, beforeEach, afterEach } from 'vitest';
// i18n をグローバルに初期化する（react-i18next はグローバル i18n を参照するため、
// コンポーネントテストは I18nextProvider なしで useTranslation を利用できる）。
import i18n from './i18n';

expect.extend(matchers);

// jsdom 環境では localStorage が機能しないことがあり、LanguageDetector が
// navigator.language（en-US）を選んでしまう。既存テストは日本語表示を前提とするため、
// 初期化直後に言語を既定(ja)へ固定する。
if (i18n.language !== DEFAULT_LANGUAGE) {
  void i18n.changeLanguage(DEFAULT_LANGUAGE);
}

// 各テストの開始・終了時に言語状態を既定(ja)へリセットし、テスト間の干渉を防ぐ。
beforeEach(() => {
  if (i18n.language !== DEFAULT_LANGUAGE) {
    void i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

afterEach(() => {
  if (i18n.language !== DEFAULT_LANGUAGE) {
    void i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});
