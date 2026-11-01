import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { describeReopenError } from './reopen-error';
import type { AppError } from '../types/api';

describe('describeReopenError', () => {
  // A FORBIDDEN error carrying an English backend message must NOT leak the
  // English text to the user: code/status is judged first and mapped to the
  // localized string (default language ja in tests).
  it('converts a 403 / FORBIDDEN error to a localized message even when the backend message is English', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      statusCode: 403,
      message: 'You cannot reopen this session.',
    };

    const message = describeReopenError(error);

    expect(message).toBe(i18n.t('review:reopen.error.forbidden'));
    expect(message).not.toContain('You cannot');
  });

  it('converts a 404 / NOT_FOUND error to a localized message', () => {
    const error: AppError = {
      code: 'NOT_FOUND',
      statusCode: 404,
      message: 'Session not found.',
    };

    const message = describeReopenError(error);

    expect(message).toBe(i18n.t('review:reopen.error.notFound'));
    expect(message).not.toContain('not found');
  });

  it('converts a 400 / VALIDATION_ERROR error to a localized message', () => {
    const error: AppError = {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: 'Session is not completed.',
    };

    const message = describeReopenError(error);

    expect(message).toBe(i18n.t('review:reopen.error.notCompleted'));
    expect(message).not.toContain('not completed');
  });

  // Code is honoured even if statusCode is absent.
  it('maps the FORBIDDEN code to a localized message when statusCode is missing', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    };

    expect(describeReopenError(error)).toBe(
      i18n.t('review:reopen.error.forbidden')
    );
  });

  // Unknown codes/statuses fall back to a localized generic message rather than
  // echoing an arbitrary (possibly English) backend message.
  it('falls back to a localized generic message for unknown errors with an English message', () => {
    const error: AppError = {
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      message: 'Something went wrong.',
    };

    const message = describeReopenError(error);

    expect(message).toBe(i18n.t('review:reopen.error.generic'));
    expect(message).not.toContain('Something went wrong');
  });
});
