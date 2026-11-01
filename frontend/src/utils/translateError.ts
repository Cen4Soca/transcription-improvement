import type { TOptions } from 'i18next';
import i18n from '../i18n';
import type { AppError } from '../types/api';

/**
 * translateError - AppError を表示用メッセージへ変換する単一の正。
 *
 * ロジック:
 * - `errorCode`（バックエンドが返す詳細コード）があれば `errors` namespace で翻訳する。
 * - errors namespace に該当キーが無い（未知コード）場合は、返却された `message` に
 *   フォールバックする（`defaultValue` による自動フォールバック）。
 * - `errorCode` 自体が無い場合も `message` をそのまま返す。
 *
 * React 外（サービス層など）からも呼べるよう i18n インスタンスを直接使う。
 * React コンポーネント内でも `t` ではなく本ヘルパを使い、実装を一本化する。
 *
 * 補間が必要な詳細コード（count 等）がある場合は `options` に補間値を渡す。
 * `defaultValue` は常に `error.message` で上書きするため、未知コードは必ず
 * サーバーメッセージにフォールバックする。
 *
 * 規約: `.kiro/steering/i18n-and-errors.md`「フロントエンドのエラー表示」。
 */
export function translateError(
  error: Pick<AppError, 'message' | 'errorCode'>,
  options?: TOptions
): string {
  const message = error.message ?? '';

  if (!error.errorCode) {
    return message;
  }

  return i18n.t(`errors:${error.errorCode}`, {
    defaultValue: message,
    ...options,
  });
}
