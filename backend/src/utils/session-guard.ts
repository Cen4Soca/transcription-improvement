import { validationError } from '../utils/error-handler.js';
import type { SessionRecord } from '../repositories/session-repository.js';

/**
 * Assert that a session is editable (i.e. not COMPLETED).
 *
 * A COMPLETED session is confirmed and must not accept any further mutation
 * (corrections, speaker-label changes, conflict resolution). Callers invoke
 * this guard before performing a mutation so that the whole write path is
 * rejected consistently with the same validationError shape.
 *
 * @throws validationError (400 VALIDATION_ERROR) when the session is COMPLETED
 */
export function assertSessionEditable(session: SessionRecord): void {
  if (session.status === 'COMPLETED') {
    throw validationError('このセッションは既に完了しているため編集できません。');
  }
}
