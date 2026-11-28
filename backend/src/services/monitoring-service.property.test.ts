import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  applyBasicFilters,
  calcProgressPercent,
  countCorrectedSegments,
  type SessionMonitoringFilters,
} from './monitoring-service.js';
import type { SessionRecord } from '../repositories/session-repository.js';

const sessionArb: fc.Arbitrary<SessionRecord> = fc.record({
  sessionId: fc.uuid(),
  name: fc.string(),
  status: fc.constantFrom('PENDING', 'IN_PROGRESS', 'COMPLETED') as fc.Arbitrary<SessionRecord['status']>,
  assignedUserId: fc.option(fc.constantFrom('u1', 'u2'), { nil: undefined }),
  assignedTeamId: fc.option(fc.constantFrom('t1', 't2'), { nil: undefined }),
  assignedReviewerCount: fc.integer({ min: 0, max: 5 }),
  consensusThreshold: fc.constant(67),
  createdAt: fc.constant('2026-01-01T00:00:00.000Z'),
  updatedAt: fc.constant('2026-01-01T00:00:00.000Z'),
});

const filtersArb: fc.Arbitrary<SessionMonitoringFilters> = fc.record(
  {
    status: fc.constantFrom('PENDING', 'IN_PROGRESS', 'COMPLETED') as fc.Arbitrary<SessionRecord['status']>,
    teamId: fc.constantFrom('t1', 't2'),
    userId: fc.constantFrom('u1', 'u2'),
    unassignedOnly: fc.boolean(),
  },
  { requiredKeys: [] }
);

describe('Feature: session-monitoring, Property 2: filters only narrow the result', () => {
  /**
   * **Validates: filter semantics (status / team / reviewer / unassigned)**
   * The filtered list is a subsequence of the input: nothing is invented or reordered.
   */
  it('filter result is an ordered subset of the input', () => {
    fc.assert(
      fc.property(fc.array(sessionArb, { maxLength: 20 }), filtersArb, (sessions, filters) => {
        const participantIds = new Set(sessions.filter((_, i) => i % 2 === 0).map((s) => s.sessionId));
        const result = applyBasicFilters(sessions, filters, participantIds);
        let cursor = 0;
        for (const item of result) {
          const found = sessions.indexOf(item, cursor);
          if (found === -1) return false;
          cursor = found + 1;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: filter semantics**
   * Adding a filter never grows the result.
   */
  it('adding a status filter never increases the result size', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { maxLength: 20 }),
        filtersArb,
        fc.constantFrom('PENDING', 'IN_PROGRESS', 'COMPLETED') as fc.Arbitrary<SessionRecord['status']>,
        (sessions, filters, status) => {
          const base = applyBasicFilters(sessions, { ...filters, status: undefined });
          const narrowed = applyBasicFilters(sessions, { ...filters, status });
          return narrowed.length <= base.length;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: session-monitoring, Property 3: progress bounds', () => {
  /**
   * **Validates: progress definition (unique segments / total segments)**
   * Progress is within 0-100, duplicates count once, and never exceeds the session's segments.
   */
  it('progress is within 0..100 and duplicate corrections count once', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 15 }),
        fc.array(
          fc.record({
            segmentId: fc.string({ minLength: 1, maxLength: 4 }),
            correctionType: fc.constantFrom('TEXT', 'SPEAKER', 'SPEAKER_RENAME') as fc.Arbitrary<'TEXT' | 'SPEAKER' | 'SPEAKER_RENAME'>,
          }),
          { maxLength: 60 }
        ),
        (segmentIds, corrections) => {
          const idSet = new Set(segmentIds);
          const corrected = countCorrectedSegments(corrections, idSet);
          const doubled = countCorrectedSegments([...corrections, ...corrections], idSet);
          const percent = calcProgressPercent(corrected, idSet.size);
          return (
            corrected <= idSet.size &&
            doubled === corrected &&
            percent >= 0 &&
            percent <= 100
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
