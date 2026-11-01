import type { AppErrorOptions } from '../types/index.js';

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: string;
  /**
   * Detailed, semantic error code (e.g. SESSION_NOT_FOUND). Layered on top of
   * the HTTP-category `code`. Optional for backward compatibility.
   */
  readonly errorCode?: string;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.errorCode = options.errorCode;
  }
}

/**
 * Error factories.
 *
 * Signature: (message, details?, errorCode?).
 *
 * NOTE: `details` remains the 2nd argument for backward compatibility with the
 * many existing `factory(message, details)` call sites. The detailed semantic
 * `errorCode` is the optional 3rd argument (see utils/error-codes.ts).
 */

export function notFoundError(
  message: string,
  details?: string,
  errorCode?: string
): AppError {
  return new AppError({
    code: 'NOT_FOUND',
    message,
    statusCode: 404,
    details,
    errorCode,
  });
}

export function validationError(
  message: string,
  details?: string,
  errorCode?: string
): AppError {
  return new AppError({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
    details,
    errorCode,
  });
}

export function forbiddenError(
  message: string,
  details?: string,
  errorCode?: string
): AppError {
  return new AppError({
    code: 'FORBIDDEN',
    message,
    statusCode: 403,
    details,
    errorCode,
  });
}

export function internalError(
  message: string,
  details?: string,
  errorCode?: string
): AppError {
  return new AppError({
    code: 'INTERNAL_ERROR',
    message,
    statusCode: 500,
    details,
    errorCode,
  });
}

export function quotaExceededError(
  message: string,
  details?: string,
  errorCode?: string
): AppError {
  return new AppError({
    code: 'QUOTA_EXCEEDED',
    message,
    statusCode: 429,
    details,
    errorCode,
  });
}
