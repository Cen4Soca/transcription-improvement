import { describe, it, expect } from 'vitest';
import {
  validateSessionName,
  describeRenameError,
  SESSION_NAME_RULE_TEXT,
} from './session-name';
import type { AppError } from '../types/api';

describe('validateSessionName', () => {
  it('0文字（空文字）は必須エラー', () => {
    const result = validateSessionName('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('セッション名を入力してください。');
    }
  });

  it('空白のみは必須エラー（トリム後 0 文字）', () => {
    const result = validateSessionName('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('セッション名を入力してください。');
    }
  });

  it('1文字は OK（下限境界）', () => {
    const result = validateSessionName('a');
    expect(result).toEqual({ ok: true, value: 'a' });
  });

  it('100文字は OK（上限境界）', () => {
    const name = 'a'.repeat(100);
    const result = validateSessionName(name);
    expect(result).toEqual({ ok: true, value: name });
  });

  it('101文字は長さエラー（上限超過）', () => {
    const result = validateSessionName('a'.repeat(101));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('セッション名は100文字以内で入力してください。');
    }
  });

  it('前後の空白をトリムして value を返す', () => {
    const result = validateSessionName('  会議録A  ');
    expect(result).toEqual({ ok: true, value: '会議録A' });
  });

  it('トリム後ちょうど100文字になる入力は OK', () => {
    const result = validateSessionName(`  ${'あ'.repeat(100)}  `);
    expect(result).toEqual({ ok: true, value: 'あ'.repeat(100) });
  });
});

describe('describeRenameError', () => {
  it('VALIDATION_ERROR はバリデーションルール文を返す', () => {
    const error: AppError = {
      code: 'VALIDATION_ERROR',
      message: 'Session name must be between 1 and 100 characters.',
    };
    expect(describeRenameError(error)).toBe(SESSION_NAME_RULE_TEXT);
  });

  it('その他のコードは汎用文を返す', () => {
    const error: AppError = {
      code: 'INTERNAL_ERROR',
      message: 'Something failed.',
    };
    expect(describeRenameError(error)).toBe(
      'セッション名の更新に失敗しました。しばらくしてからもう一度お試しください。'
    );
  });
});
