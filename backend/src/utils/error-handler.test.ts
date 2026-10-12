import { describe, it, expect } from 'vitest';
import {
  AppError,
  notFoundError,
  validationError,
  forbiddenError,
  internalError,
} from './error-handler.js';

describe('AppError', () => {
  it('creates an error with all properties', () => {
    const error = new AppError({
      code: 'TEST_ERROR',
      message: 'テストエラー',
      statusCode: 400,
      details: 'some details',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('テストエラー');
    expect(error.statusCode).toBe(400);
    expect(error.details).toBe('some details');
  });

  it('creates an error without details', () => {
    const error = new AppError({
      code: 'NO_DETAILS',
      message: 'no details',
      statusCode: 500,
    });

    expect(error.details).toBeUndefined();
  });
});

describe('error factory functions', () => {
  it('notFoundError returns 404', () => {
    const error = notFoundError('リソースが見つかりません');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('validationError returns 400', () => {
    const error = validationError('入力が不正です', 'field is required');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toBe('field is required');
  });

  it('forbiddenError returns 403', () => {
    const error = forbiddenError('アクセスが拒否されました');
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('internalError returns 500', () => {
    const error = internalError('内部エラー');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
  });
});
