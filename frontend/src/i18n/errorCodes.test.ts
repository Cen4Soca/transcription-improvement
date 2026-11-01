import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import jaErrors from './locales/ja/errors.json';
import enErrors from './locales/en/errors.json';

/**
 * errors namespace は backend の ERROR_CODES（詳細エラーコードの正）を
 * すべて翻訳キーとして持たなければならない。バックエンドが返す errorCode を
 * フロントが漏れなく翻訳できることを保証する。
 *
 * backend のソースはフロントから import できない（別パッケージ・構造上の制約）ため、
 * error-codes.ts を読み取り値を抽出して検証する軽量テスト。
 */
function loadErrorCodes(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const errorCodesPath = resolve(
    here,
    '../../../backend/src/utils/error-codes.ts'
  );
  const source = readFileSync(errorCodesPath, 'utf-8');
  const matches = source.matchAll(/^\s+[A-Z_]+:\s*'([A-Z_]+)',/gm);
  return [...matches].map((m) => m[1]);
}

describe('errors namespace: ERROR_CODES の網羅', () => {
  const errorCodes = loadErrorCodes();

  it('backend の error-codes.ts から複数のコードを読み取れる', () => {
    expect(errorCodes.length).toBeGreaterThan(100);
  });

  it('ERROR_CODES の全コードが ja の errors namespace に存在する', () => {
    const jaKeys = Object.keys(jaErrors);
    const missing = errorCodes.filter((code) => !jaKeys.includes(code));
    expect(missing, `ja.errors に不足しているコード`).toEqual([]);
  });

  it('ERROR_CODES の全コードが en の errors namespace に存在する', () => {
    const enKeys = Object.keys(enErrors);
    const missing = errorCodes.filter((code) => !enKeys.includes(code));
    expect(missing, `en.errors に不足しているコード`).toEqual([]);
  });
});
