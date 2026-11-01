import { describe, it, expect } from 'vitest';
import {
  AppError,
  notFoundError,
  validationError,
  forbiddenError,
  internalError,
  quotaExceededError,
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

  it('quotaExceededError returns 429', () => {
    const error = quotaExceededError('クォータを超過しました', 'quota limit reached');
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('QUOTA_EXCEEDED');
    expect(error.details).toBe('quota limit reached');
  });
});

describe('detailed errorCode support', () => {
  it('AppError carries an optional errorCode', () => {
    const error = new AppError({
      code: 'NOT_FOUND',
      message: 'Session not found',
      statusCode: 404,
      errorCode: 'SESSION_NOT_FOUND',
    });
    expect(error.errorCode).toBe('SESSION_NOT_FOUND');
  });

  it('errorCode is undefined when not provided', () => {
    const error = notFoundError('Not found');
    expect(error.errorCode).toBeUndefined();
  });

  it('factories accept a detailed errorCode as the 3rd argument', () => {
    const error = validationError('Invalid language', undefined, 'PREFERRED_LANGUAGE_INVALID');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toBeUndefined();
    expect(error.errorCode).toBe('PREFERRED_LANGUAGE_INVALID');
  });

  it('factories keep details as the 2nd argument alongside errorCode', () => {
    const error = forbiddenError('Denied', 'actor lacks role', 'INSUFFICIENT_ROLE');
    expect(error.details).toBe('actor lacks role');
    expect(error.errorCode).toBe('INSUFFICIENT_ROLE');
  });
});
