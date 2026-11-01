import i18n from '../i18n';
import type { AppError } from '../types/api';
import { translateError } from './translateError';

/**
 * language-model-error.ts - カスタム言語モデル API のエラーを
 * ユーザー向け表示メッセージへ変換する。
 *
 * バックエンドは英語メッセージ + 詳細エラーコードを返す。フロントエンドでは
 * errorCode ベースの翻訳（translateError）を基本とするが、クォータ超過
 * （QUOTA_EXCEEDED / HTTP 429）だけは Transcribe のモデル数上限に達したことが
 * 分かる専用メッセージを表示する。文言は languageModel namespace で翻訳する。
 */

/**
 * カスタム言語モデル API のエラーを表示用メッセージに変換する。
 * - QUOTA_EXCEEDED: モデル数上限に達した旨の専用メッセージ
 * - その他: errorCode があれば errors namespace で翻訳し、無ければ message、
 *   どちらも無ければ汎用文を返す
 */
export function describeLanguageModelError(error: AppError): string {
  if (error.code === 'QUOTA_EXCEEDED') {
    return i18n.t('languageModel:error.quotaExceeded');
  }
  // errorCode があれば errors namespace で翻訳し、無ければ message にフォールバックする。
  return translateError(error) || i18n.t('languageModel:error.generic');
}
