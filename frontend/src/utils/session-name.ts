import i18n from '../i18n';
import type { AppError } from '../types/api';

/**
 * session-name.ts - セッション名のクライアント側バリデーションと
 * API エラーメッセージの変換
 *
 * サーバー側（PATCH /sessions/{sessionId}/name）の制約と揃える:
 * - 必須
 * - トリム後 1〜100 文字（境界は包含）
 * - 前後の空白はトリムされる
 *
 * React 外からも呼べるよう i18n インスタンスを直接使う。
 */

/** セッション名の最大文字数（トリム後） */
export const SESSION_NAME_MAX_LENGTH = 100;

/** セッション名のバリデーションルール文（ⓘ ツールチップで表示する）を返す。 */
export function getSessionNameRuleText(): string {
  return i18n.t('review:sessionName.rule');
}

/**
 * セッション名をクライアント側で検証する。
 * trim 後 1 文字未満なら必須エラー、100 文字超なら長さエラー。
 * OK の場合は trim 済みの value を返す。
 */
export function validateSessionName(
  raw: string
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length < 1) {
    return { ok: false, message: i18n.t('review:sessionName.validation.required') };
  }
  if (trimmed.length > SESSION_NAME_MAX_LENGTH) {
    return { ok: false, message: i18n.t('review:sessionName.validation.tooLong') };
  }
  return { ok: true, value: trimmed };
}

/**
 * セッション名変更 API のエラー（英語メッセージ）を表示用に変換する。
 * VALIDATION_ERROR はバリデーションルール文、それ以外は汎用文を返す。
 */
export function describeRenameError(error: AppError): string {
  if (error.code === 'VALIDATION_ERROR') {
    return getSessionNameRuleText();
  }
  return i18n.t('review:sessionName.updateFailed');
}
