import { describe, it, expect } from 'vitest';
import { describeReopenError } from './reopen-error';
import type { AppError } from '../types/api';

describe('describeReopenError', () => {
  // A FORBIDDEN error carrying an English backend message must NOT leak the
  // English text to the user: code/status is judged first and mapped to 日本語.
  it('converts a 403 / FORBIDDEN error to Japanese even when the backend message is English', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      statusCode: 403,
      message: 'You cannot reopen this session.',
    };

    const message = describeReopenError(error);

    expect(message).toBe('このセッションを差し戻す権限がありません。');
    expect(message).not.toContain('You cannot');
  });

  it('converts a 404 / NOT_FOUND error to Japanese', () => {
    const error: AppError = {
      code: 'NOT_FOUND',
      statusCode: 404,
      message: 'Session not found.',
    };

    const message = describeReopenError(error);

    expect(message).toBe('セッションが見つかりません。');
    expect(message).not.toContain('not found');
  });

  it('converts a 400 / VALIDATION_ERROR error to Japanese', () => {
    const error: AppError = {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: 'Session is not completed.',
    };

    const message = describeReopenError(error);

    expect(message).toBe('完了していないセッションは差し戻しできません。');
    expect(message).not.toContain('not completed');
  });

  // Code is honoured even if statusCode is absent.
  it('maps the FORBIDDEN code to Japanese when statusCode is missing', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    };

    expect(describeReopenError(error)).toBe(
      'このセッションを差し戻す権限がありません。'
    );
  });

  // Unknown codes/statuses fall back to a Japanese generic message rather than
  // echoing an arbitrary (possibly English) backend message.
  it('falls back to a Japanese generic message for unknown errors with an English message', () => {
    const error: AppError = {
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      message: 'Something went wrong.',
    };

    const message = describeReopenError(error);

    expect(message).toBe(
      '差し戻しに失敗しました。時間をおいて再度お試しください。'
    );
    expect(message).not.toContain('Something went wrong');
  });
});
