import i18n from '../i18n';
import type { AppError } from '../types/api';

/**
 * reopen-error.ts - 差し戻し API（POST /sessions/{sessionId}/reopen）の
 * エラーを ADMIN / TEAM_LEADER 向けの表示メッセージに変換する。
 *
 * コード / HTTP ステータスを先に判定して定型文（review namespace）へ変換し、
 * 英語のバックエンドメッセージがそのまま利用者へ露出しないようにする。
 * 既知の分岐に該当しない場合のみ、汎用フォールバックを返す。
 * React 外からも呼べるよう i18n インスタンスを直接使う。
 */
export function describeReopenError(error: AppError): string {
  const status = error.statusCode;
  const code = error.code;

  if (status === 403 || code === 'FORBIDDEN') {
    return i18n.t('review:reopen.error.forbidden');
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return i18n.t('review:reopen.error.notFound');
  }
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return i18n.t('review:reopen.error.notCompleted');
  }
  return i18n.t('review:reopen.error.generic');
}
