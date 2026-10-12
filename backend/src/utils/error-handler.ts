import type { AppErrorOptions } from '../types/index.js';

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: string;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

export function notFoundError(message: string, details?: string): AppError {
  return new AppError({
    code: 'NOT_FOUND',
    message,
    statusCode: 404,
    details,
  });
}

export function validationError(message: string, details?: string): AppError {
  return new AppError({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
    details,
  });
}

export function forbiddenError(message: string, details?: string): AppError {
  return new AppError({
    code: 'FORBIDDEN',
    message,
    statusCode: 403,
    details,
  });
}

export function internalError(message: string, details?: string): AppError {
  return new AppError({
    code: 'INTERNAL_ERROR',
    message,
    statusCode: 500,
    details,
  });
}

export function quotaExceededError(message: string, details?: string): AppError {
  return new AppError({
    code: 'QUOTA_EXCEEDED',
    message,
    statusCode: 429,
    details,
  });
}
