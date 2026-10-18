import { describe, it, expect } from 'vitest';
import { assertSessionEditable } from './session-guard.js';
import type { SessionRecord } from '../repositories/session-repository.js';

function makeSession(status: SessionRecord['status']): SessionRecord {
  return {
    sessionId: 'session-001',
    name: 'Sample',
    status,
    assignedReviewerCount: 0,
    consensusThreshold: 67,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('assertSessionEditable', () => {
  it('throws a validationError (400 VALIDATION_ERROR, Japanese message) for a COMPLETED session', () => {
    try {
      assertSessionEditable(makeSession('COMPLETED'));
      throw new Error('expected assertSessionEditable to throw');
    } catch (error: unknown) {
      expect(error).toMatchObject({
        name: 'AppError',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'このセッションは既に完了しているため編集できません。',
      });
    }
  });

  it('does not throw for a PENDING session', () => {
    expect(() => assertSessionEditable(makeSession('PENDING'))).not.toThrow();
  });

  it('does not throw for an IN_PROGRESS session', () => {
    expect(() => assertSessionEditable(makeSession('IN_PROGRESS'))).not.toThrow();
  });
});
