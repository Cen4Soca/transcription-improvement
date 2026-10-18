import type { AppError } from '../types/api';

/**
 * language-model-error.ts - カスタム言語モデル API のエラー（英語メッセージ）を
 * 日本語に変換する。
 *
 * バックエンドは英語のエラーメッセージを返す（tech ルール）。フロントエンドで
 * ユーザー向けの日本語メッセージに変換する。特にクォータ超過（QUOTA_EXCEEDED /
 * HTTP 429）は、Transcribe のモデル数上限に達したことが分かるメッセージを表示する。
 */

/** クォータ超過時のユーザー向けメッセージ（モデル数上限に達したことを明示） */
export const QUOTA_EXCEEDED_MESSAGE =
  'カスタム言語モデルの作成上限に達しています。既存のモデルを削除するか、上限緩和を申請してください。';

/**
 * カスタム言語モデル API のエラーを日本語メッセージに変換する。
 * - QUOTA_EXCEEDED: モデル数上限に達した旨のメッセージ
 * - その他: バックエンドのメッセージがあればそれを、無ければ汎用文を返す
 */
export function describeLanguageModelError(error: AppError): string {
  if (error.code === 'QUOTA_EXCEEDED') {
    return QUOTA_EXCEEDED_MESSAGE;
  }
  return error.message || 'エラーが発生しました。しばらくしてからもう一度お試しください。';
}
