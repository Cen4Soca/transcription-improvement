import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assertSessionEditable } from './session-guard.js';
import type { SessionRecord } from '../repositories/session-repository.js';

describe('Feature: completed-session-readonly, Property 1: COMPLETED は常に編集不可', () => {
  /**
   * **Validates: Requirements 2.20**
   *
   * assertSessionEditable throws (rejects the mutation) if and only if the
   * session status is COMPLETED, regardless of the other session attributes.
   */
  it('throws iff status === COMPLETED', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<SessionRecord['status']>('PENDING', 'IN_PROGRESS', 'COMPLETED'),
        fc.record({
          sessionId: fc.string(),
          name: fc.string(),
          assignedReviewerCount: fc.integer({ min: 0, max: 100 }),
          consensusThreshold: fc.integer({ min: 1, max: 100 }),
          createdAt: fc.date().map((d) => d.toISOString()),
          updatedAt: fc.date().map((d) => d.toISOString()),
          assignedUserId: fc.option(fc.string(), { nil: undefined }),
          assignedTeamId: fc.option(fc.string(), { nil: undefined }),
          speakerLabels: fc.option(fc.array(fc.string()), { nil: undefined }),
        }),
        (status, attrs) => {
          const session: SessionRecord = { ...attrs, status };

          let threw = false;
          try {
            assertSessionEditable(session);
          } catch {
            threw = true;
          }

          expect(threw).toBe(status === 'COMPLETED');
        }
      ),
      { numRuns: 100 }
    );
  });
});
