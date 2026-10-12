import type { AppError } from '../types/api';

/**
 * reopen-error.ts - 差し戻し API（POST /sessions/{sessionId}/reopen）の
 * エラーを ADMIN / TEAM_LEADER 向けの日本語メッセージに変換する。
 *
 * コード / HTTP ステータスを先に判定して日本語の定型文へ変換し、
 * 英語のバックエンドメッセージがそのまま利用者へ露出しないようにする。
 * 既知の分岐に該当しない場合のみ、日本語の汎用フォールバックを返す。
 */
export function describeReopenError(error: AppError): string {
  const status = error.statusCode;
  const code = error.code;

  if (status === 403 || code === 'FORBIDDEN') {
    return 'このセッションを差し戻す権限がありません。';
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return 'セッションが見つかりません。';
  }
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return '完了していないセッションは差し戻しできません。';
  }
  return '差し戻しに失敗しました。時間をおいて再度お試しください。';
}
