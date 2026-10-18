import type { AppError } from '../types/api';

/**
 * session-name.ts - セッション名のクライアント側バリデーションと
 * API エラーメッセージの日本語変換
 *
 * サーバー側（PATCH /sessions/{sessionId}/name）の制約と揃える:
 * - 必須
 * - トリム後 1〜100 文字（境界は包含）
 * - 前後の空白はトリムされる
 */

/** セッション名のバリデーションルール文（ⓘ ツールチップで表示する） */
export const SESSION_NAME_RULE_TEXT =
  'セッション名は必須です。1〜100文字で入力してください。前後の空白は自動的に削除されます。';

/** セッション名の最大文字数（トリム後） */
export const SESSION_NAME_MAX_LENGTH = 100;

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
    return { ok: false, message: 'セッション名を入力してください。' };
  }
  if (trimmed.length > SESSION_NAME_MAX_LENGTH) {
    return { ok: false, message: 'セッション名は100文字以内で入力してください。' };
  }
  return { ok: true, value: trimmed };
}

/**
 * セッション名変更 API のエラー（英語メッセージ）を日本語に変換する。
 * VALIDATION_ERROR はバリデーションルール文、それ以外は汎用文を返す。
 */
export function describeRenameError(error: AppError): string {
  if (error.code === 'VALIDATION_ERROR') {
    return SESSION_NAME_RULE_TEXT;
  }
  return 'セッション名の更新に失敗しました。しばらくしてからもう一度お試しください。';
}
