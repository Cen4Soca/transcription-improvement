import { describe, it, expect } from 'vitest';
import { successResponse, errorResponse } from './response-builder.js';
import { AppError } from './error-handler.js';

describe('successResponse', () => {
  it('returns 200 with JSON body and CORS headers', () => {
    const result = successResponse({ data: 'test' });

    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    });
    expect(JSON.parse(result.body as string)).toEqual({ data: 'test' });
  });

  it('supports custom status codes', () => {
    const result = successResponse({ id: '123' }, 201);
    expect(result.statusCode).toBe(201);
  });
});

describe('errorResponse', () => {
  it('returns structured error for AppError', () => {
    const appError = new AppError({
      code: 'CORRECTION_SAVE_FAILED',
      message: '修正内容の保存に失敗しました。',
      statusCode: 500,
      details: 'DynamoDB write capacity exceeded',
    });

    const result = errorResponse(appError);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body).toEqual({
      error: {
        code: 'CORRECTION_SAVE_FAILED',
        message: '修正内容の保存に失敗しました。',
        details: 'DynamoDB write capacity exceeded',
      },
    });
  });

  it('omits details when not provided in AppError', () => {
    const appError = new AppError({
      code: 'NOT_FOUND',
      message: 'リソースが見つかりません',
      statusCode: 404,
    });

    const result = errorResponse(appError);
    const body = JSON.parse(result.body as string);
    expect(body.error.details).toBeUndefined();
  });

  it('returns 500 for unknown errors', () => {
    const result = errorResponse(new Error('unexpected'));

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('予期しないエラーが発生しました。');
    expect(body.error.details).toBe('unexpected');
  });

  it('returns 500 for non-Error values', () => {
    const result = errorResponse('string error');

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.details).toBe('An unexpected error occurred');
  });

  it('includes CORS headers in error responses', () => {
    const result = errorResponse(new Error('test'));

    expect(result.headers).toMatchObject({
      'Access-Control-Allow-Origin': '*',
    });
  });
});
