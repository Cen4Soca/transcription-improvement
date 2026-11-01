import i18n from '../i18n';
import type { AppError } from '../types/api';

/**
 * aggregate-error.ts - 強制集約 API（POST /sessions/{sessionId}/aggregate）の
 * エラーを ADMIN / TEAM_LEADER 向けの表示メッセージに変換する。
 *
 * コード / HTTP ステータスを先に判定して定型文（review namespace）へ変換し、
 * 英語のバックエンドメッセージがそのまま利用者へ露出しないようにする。
 * 既知の分岐に該当しない場合のみ、汎用フォールバックを返す。
 * React 外からも呼べるよう i18n インスタンスを直接使う。
 */
export function describeAggregateError(error: AppError): string {
  const status = error.statusCode;
  const code = error.code;

  if (status === 403 || code === 'FORBIDDEN') {
    return i18n.t('review:aggregate.error.forbidden');
  }
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return i18n.t('review:aggregate.error.notAggregatable');
  }
  return i18n.t('review:aggregate.error.generic');
}
