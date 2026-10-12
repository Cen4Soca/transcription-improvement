import type { AppError } from '../types/api';

/**
 * aggregate-error.ts - 強制集約 API（POST /sessions/{sessionId}/aggregate）の
 * エラーを ADMIN / TEAM_LEADER 向けの日本語メッセージに変換する。
 *
 * コード / HTTP ステータスを先に判定して日本語の定型文へ変換し、
 * 英語のバックエンドメッセージがそのまま利用者へ露出しないようにする。
 * 既知の分岐に該当しない場合のみ、日本語の汎用フォールバックを返す。
 */
export function describeAggregateError(error: AppError): string {
  const status = error.statusCode;
  const code = error.code;

  if (status === 403 || code === 'FORBIDDEN') {
    return 'このセッションを集約する権限がありません。';
  }
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return 'このセッションは集約できません。既に完了しているか、集約できない状態の可能性があります。';
  }
  return '集約に失敗しました。時間をおいて再度お試しください。';
}
