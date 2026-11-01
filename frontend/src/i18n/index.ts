import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import jaCommon from './locales/ja/common.json';
import enCommon from './locales/en/common.json';
import jaNavigation from './locales/ja/navigation.json';
import enNavigation from './locales/en/navigation.json';
import jaReview from './locales/ja/review.json';
import enReview from './locales/en/review.json';
import jaAdmin from './locales/ja/admin.json';
import enAdmin from './locales/en/admin.json';
import jaRanking from './locales/ja/ranking.json';
import enRanking from './locales/en/ranking.json';
import jaConsensus from './locales/ja/consensus.json';
import enConsensus from './locales/en/consensus.json';
import jaUpload from './locales/ja/upload.json';
import enUpload from './locales/en/upload.json';
import jaLanguageModel from './locales/ja/languageModel.json';
import enLanguageModel from './locales/en/languageModel.json';
import jaProfile from './locales/ja/profile.json';
import enProfile from './locales/en/profile.json';
import jaTranscriptionJob from './locales/ja/transcriptionJob.json';
import enTranscriptionJob from './locales/en/transcriptionJob.json';
import jaErrors from './locales/ja/errors.json';
import enErrors from './locales/en/errors.json';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
} from './constants';

// 定数・型・ヘルパは constants から再エクスポートする（初期化前にも参照できる）。
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  type SupportedLanguage,
} from './constants';

/**
 * 翻訳リソース。
 *
 * namespace は機能別に分割する。各画面/機能のキーは Task 8-10 で順次埋める。
 * キー命名規約などの詳細は `.kiro/steering/i18n-and-errors.md` を参照。
 */
export const resources = {
  ja: {
    common: jaCommon,
    navigation: jaNavigation,
    review: jaReview,
    admin: jaAdmin,
    ranking: jaRanking,
    consensus: jaConsensus,
    upload: jaUpload,
    languageModel: jaLanguageModel,
    profile: jaProfile,
    transcriptionJob: jaTranscriptionJob,
    errors: jaErrors,
  },
  en: {
    common: enCommon,
    navigation: enNavigation,
    review: enReview,
    admin: enAdmin,
    ranking: enRanking,
    consensus: enConsensus,
    upload: enUpload,
    languageModel: enLanguageModel,
    profile: enProfile,
    transcriptionJob: enTranscriptionJob,
    errors: enErrors,
  },
} as const;

/** 登録済みの全 namespace。 */
export const NAMESPACES = [
  'common',
  'navigation',
  'review',
  'admin',
  'ranking',
  'consensus',
  'upload',
  'languageModel',
  'profile',
  'transcriptionJob',
  'errors',
] as const;

/**
 * i18next を初期化する。
 *
 * 言語の決定優先順位: localStorage > navigator.language > 既定(ja)。
 * （プロファイル値による上書きは認証完了後に changeLanguage で行う。）
 */
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: DEFAULT_LANGUAGE,
    // 'en-US' などを 'en' に丸める
    load: 'languageOnly',
    ns: [...NAMESPACES],
    defaultNS: 'common',
    detection: {
      // localStorage を最優先し、無ければブラウザ言語を使う
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      // 手動切替時の保存は useLanguage 側で明示的に行うため自動キャッシュは無効化する
      caches: [],
    },
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });

export default i18n;
