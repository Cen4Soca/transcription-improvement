import { describe, it, expect } from 'vitest';
import { describeAggregateError } from './aggregate-error';
import type { AppError } from '../types/api';

describe('describeAggregateError', () => {
  // A FORBIDDEN error carrying an English backend message must NOT leak the
  // English text to the user: code/status is judged first and mapped to 日本語.
  it('converts a 403 / FORBIDDEN error to Japanese even when the backend message is English', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      statusCode: 403,
      message: 'You cannot aggregate this session.',
    };

    const message = describeAggregateError(error);

    expect(message).toBe('このセッションを集約する権限がありません。');
    expect(message).not.toContain('You cannot');
  });

  // Likewise a 400 / VALIDATION_ERROR with an English message is converted.
  it('converts a 400 / VALIDATION_ERROR error to Japanese even when the backend message is English', () => {
    const error: AppError = {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: 'This session is already completed.',
    };

    const message = describeAggregateError(error);

    expect(message).toBe(
      'このセッションは集約できません。既に完了しているか、集約できない状態の可能性があります。'
    );
    expect(message).not.toContain('already completed');
  });

  // Code is honoured even if statusCode is absent.
  it('maps the FORBIDDEN code to Japanese when statusCode is missing', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    };

    expect(describeAggregateError(error)).toBe(
      'このセッションを集約する権限がありません。'
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

    const message = describeAggregateError(error);

    expect(message).toBe('集約に失敗しました。時間をおいて再度お試しください。');
    expect(message).not.toContain('Something went wrong');
  });
});
