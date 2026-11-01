import { describe, it, expect } from 'vitest';
import { translateError } from './translateError';
import i18n from '../i18n';

describe('translateError', () => {
  it('既知コードは errors namespace の翻訳（ja デフォルト）を返す', () => {
    const result = translateError({
      message: 'Session not found',
      errorCode: 'SESSION_NOT_FOUND',
    });
    expect(result).toBe('セッションが見つかりません。');
  });

  it('en に切り替えると英語の翻訳を返す', async () => {
    await i18n.changeLanguage('en');
    const result = translateError({
      message: 'サーバー側のメッセージ',
      errorCode: 'SESSION_NOT_FOUND',
    });
    expect(result).toBe('Session not found.');
    await i18n.changeLanguage('ja');
  });

  it('未知コードは返却された message にフォールバックする', () => {
    const result = translateError({
      message: 'Something unexpected happened',
      errorCode: 'NOT_A_REAL_CODE',
    });
    expect(result).toBe('Something unexpected happened');
  });

  it('errorCode が無い場合は message をそのまま返す', () => {
    const result = translateError({ message: 'raw server message' });
    expect(result).toBe('raw server message');
  });

  it('message が空でも errorCode が既知なら翻訳を返す', () => {
    const result = translateError({ message: '', errorCode: 'TEAM_NOT_FOUND' });
    expect(result).toBe('チームが見つかりません。');
  });

  it('options で補間値を渡せる（fallback パターン）', () => {
    const result = translateError(
      { message: 'fallback', errorCode: 'fallback.genericWithStatus' },
      { status: 503 }
    );
    expect(result).toBe('エラーが発生しました (503)');
  });
});
