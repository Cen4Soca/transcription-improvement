import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { describeAggregateError } from './aggregate-error';
import type { AppError } from '../types/api';

describe('describeAggregateError', () => {
  // A FORBIDDEN error carrying an English backend message must NOT leak the
  // English text to the user: code/status is judged first and mapped to the
  // localized string (default language ja in tests).
  it('converts a 403 / FORBIDDEN error to a localized message even when the backend message is English', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      statusCode: 403,
      message: 'You cannot aggregate this session.',
    };

    const message = describeAggregateError(error);

    expect(message).toBe(i18n.t('review:aggregate.error.forbidden'));
    expect(message).not.toContain('You cannot');
  });

  // Likewise a 400 / VALIDATION_ERROR with an English message is converted.
  it('converts a 400 / VALIDATION_ERROR error to a localized message even when the backend message is English', () => {
    const error: AppError = {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: 'This session is already completed.',
    };

    const message = describeAggregateError(error);

    expect(message).toBe(i18n.t('review:aggregate.error.notAggregatable'));
    expect(message).not.toContain('already completed');
  });

  // Code is honoured even if statusCode is absent.
  it('maps the FORBIDDEN code to a localized message when statusCode is missing', () => {
    const error: AppError = {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    };

    expect(describeAggregateError(error)).toBe(
      i18n.t('review:aggregate.error.forbidden')
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

    const message = describeAggregateError(error);

    expect(message).toBe(i18n.t('review:aggregate.error.generic'));
    expect(message).not.toContain('Something went wrong');
  });
});
