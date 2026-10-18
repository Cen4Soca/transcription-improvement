import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { filterSessionsByAssignment, reconcileSelection } from './LanguageModelPage';
import type { ReviewSession } from '../types/session';

/**
 * Builds a minimal ReviewSession that satisfies the type while only `sessionId`
 * is meaningful for the filtering helpers under test. Other required fields are
 * filled with minimal type-satisfying values.
 */
function makeSession(sessionId: string): ReviewSession {
  return {
    sessionId,
    transcriptionJobId: 'job-1',
    name: 'session',
    status: 'COMPLETED',
    assignedReviewerCount: 0,
    consensusThreshold: 1,
    partialAggregationEnabled: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

const arbSessionId = fc.string({ minLength: 1, maxLength: 20 });

// Generate a session list and an assignment set drawn from overlapping id pools
// so that both "included" and "excluded" cases are exercised.
const arbSessionsAndAssignment = fc
  .tuple(
    fc.uniqueArray(arbSessionId, { maxLength: 15 }),
    fc.uniqueArray(arbSessionId, { maxLength: 15 })
  )
  .map(([sessionIds, assignedIds]) => ({
    sessions: sessionIds.map(makeSession),
    assignedSessionIds: new Set(assignedIds),
  }));

describe('Feature: language-model-source-session-team-match, Property 3: 候補絞り込みは割り当て集合に一致', () => {
  /**
   * **Validates: Requirements 2.1**
   *
   * For any session list and any set of assigned sessionIds, the filtered
   * candidates consist of exactly the sessions whose sessionId is in the
   * assignment set: every returned session is assigned (none unassigned leaks
   * through), and every session present in the list that is also assigned is
   * retained (none is dropped).
   */
  it('returns exactly the sessions whose sessionId is in the assignment set', () => {
    fc.assert(
      fc.property(arbSessionsAndAssignment, ({ sessions, assignedSessionIds }) => {
        const result = filterSessionsByAssignment(sessions, assignedSessionIds);

        // Every returned session must be assigned (no unassigned session leaks through).
        for (const s of result) {
          expect(assignedSessionIds.has(s.sessionId)).toBe(true);
        }

        // Every assigned session present in the list must be retained (nothing dropped).
        for (const s of sessions) {
          if (assignedSessionIds.has(s.sessionId)) {
            expect(result).toContain(s);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// NOTE: Property 4 (reconcileSelection) is appended by task 6.3 below this line.

// Generate a previously-selected list and an assignment set drawn from
// overlapping id pools so that both retained and dropped selections are
// exercised. prevSelected may contain duplicates to also exercise the
// order/duplicate-preservation invariant.
const arbPrevSelectedAndAssignment = fc
  .tuple(
    fc.array(arbSessionId, { maxLength: 15 }),
    fc.uniqueArray(arbSessionId, { maxLength: 15 })
  )
  .map(([prevSelected, assignedIds]) => ({
    prevSelected,
    assignedSessionIds: new Set(assignedIds),
  }));

describe('Feature: language-model-source-session-team-match, Property 4: 選択整合は「前回選択 ∩ 新割り当て集合」', () => {
  /**
   * **Validates: Requirements 2.3**
   *
   * For any previously-selected sessionId list and any set of newly-assigned
   * sessionIds, reconcileSelection yields the intersection of the two:
   * (a) every element of the result is in the assignment set (the result is a
   * subset of the new assignment set — selections not in the new team are
   * dropped), (b) every element that was in prevSelected AND in the assignment
   * set is retained (nothing assigned is dropped), and (c) the result is a
   * subsequence of prevSelected, preserving prevSelected's order and
   * duplicates.
   */
  it('returns the intersection of prevSelected and the assignment set', () => {
    fc.assert(
      fc.property(arbPrevSelectedAndAssignment, ({ prevSelected, assignedSessionIds }) => {
        const result = reconcileSelection(prevSelected, assignedSessionIds);

        // (a) Result is a subset of the new assignment set.
        for (const id of result) {
          expect(assignedSessionIds.has(id)).toBe(true);
        }

        // (b) Every prevSelected element that is assigned must be retained,
        //     with its original multiplicity (duplicates kept).
        const expected = prevSelected.filter((id) => assignedSessionIds.has(id));
        expect(result).toEqual(expected);

        // (c) The result is a subsequence of prevSelected (order/duplicates
        //     originate from prevSelected). Walk prevSelected keeping the
        //     relative order of result's elements.
        let cursor = 0;
        for (const id of prevSelected) {
          if (cursor < result.length && result[cursor] === id) {
            cursor += 1;
          }
        }
        expect(cursor).toBe(result.length);
      }),
      { numRuns: 100 }
    );
  });
});
