import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ConsensusApi } from './consensus-api.js';
import type { ApiClient } from './api-client.js';
import type { ConsensusSegment, ConsensusStatus, ReviewerAnswer } from '../types/consensus.js';

/**
 * Property-based tests for ConsensusApi + the Consensus resolve flow
 * (bugfix: missing-frontend-consensus-and-team-assignment).
 *
 * These encode design.md "Correctness Properties / Property 1" for the
 * CONSENSUS_VIEW / CONSENSUS_RESOLVE features: resolving a CONFLICT segment
 * always sends { segmentId, selectedText } to POST /consensus/{sessionId}/resolve,
 * success flips only that segment to CONFIRMED, and resolving a non-CONFLICT
 * segment surfaces the backend error as a Result without crashing the UI.
 *
 * ApiClient is mocked via vi.fn(). numRuns: 100.
 */

// --- fast-check arbitraries over the Consensus domain ---

const statusArb: fc.Arbitrary<ConsensusStatus> = fc.constantFrom(
  'UNDECIDED',
  'CONFIRMED',
  'CONFLICT'
);

const reviewerAnswerArb: fc.Arbitrary<ReviewerAnswer> = fc.record({
  text: fc.string({ minLength: 1, maxLength: 20 }),
  count: fc.integer({ min: 1, max: 10 }),
  userIds: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 5 }),
});

/** Build a ConsensusSegment whose reviewerAnswers are present iff CONFLICT. */
function segmentArb(sessionId: string): fc.Arbitrary<ConsensusSegment> {
  return fc
    .record({
      segmentId: fc.string({ minLength: 1, maxLength: 12 }),
      startTime: fc.double({ min: 0, max: 100, noNaN: true }),
      duration: fc.double({ min: 0.1, max: 10, noNaN: true }),
      originalText: fc.string({ maxLength: 30 }),
      consensusStatus: statusArb,
      consensusText: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
      reviewerAnswers: fc.array(reviewerAnswerArb, { minLength: 1, maxLength: 4 }),
    })
    .map((raw) => {
      const segment: ConsensusSegment = {
        segmentId: raw.segmentId,
        sessionId,
        startTime: raw.startTime,
        endTime: raw.startTime + raw.duration,
        originalText: raw.originalText,
        consensusStatus: raw.consensusStatus,
      };
      if (raw.consensusStatus === 'CONFIRMED' && raw.consensusText) {
        segment.consensusText = raw.consensusText;
      }
      if (raw.consensusStatus === 'CONFLICT') {
        segment.reviewerAnswers = raw.reviewerAnswers;
      }
      return segment;
    });
}

/** A list of segments with unique segmentIds for a given session. */
function segmentsArb(sessionId: string): fc.Arbitrary<ConsensusSegment[]> {
  return fc
    .uniqueArray(segmentArb(sessionId), {
      minLength: 1,
      maxLength: 8,
      selector: (s) => s.segmentId,
    });
}

function makeMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  };
}

/**
 * Pure UI-model reducer mirroring App.tsx's onResolve local update: on a
 * successful resolve, the targeted segment becomes CONFIRMED (with
 * consensusText) and every other segment is left untouched.
 */
function applyResolve(
  segments: ConsensusSegment[],
  segmentId: string,
  selectedText: string
): ConsensusSegment[] {
  return segments.map((s) =>
    s.segmentId === segmentId
      ? { ...s, consensusStatus: 'CONFIRMED' as const, consensusText: selectedText }
      : s
  );
}

describe('Feature: missing-frontend-consensus-and-team-assignment, Property 1: Consensus 解決 — CONFLICT 解決は正しい契約で送られ当該セグメントのみ CONFIRMED になる', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * For any session + any CONFLICT segment, resolveConsensus sends exactly
   * { segmentId, selectedText } to POST /consensus/{sessionId}/resolve, and on
   * success the local UI model flips ONLY that segment to CONFIRMED while every
   * other segment keeps its prior status (and its reviewerAnswers for other
   * CONFLICT segments).
   */
  it('resolving a CONFLICT segment sends the correct contract and confirms only that segment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        async (sessionId) => {
          const segmentsRun = await fc.sample(segmentsArb(sessionId), 1)[0];
          // Choose a CONFLICT segment if present; otherwise synthesize one.
          const conflict =
            segmentsRun.find((s) => s.consensusStatus === 'CONFLICT') ??
            ({
              segmentId: segmentsRun[0].segmentId,
              sessionId,
              startTime: 0,
              endTime: 1,
              originalText: 'x',
              consensusStatus: 'CONFLICT',
              reviewerAnswers: [{ text: 'a', count: 1, userIds: ['u1'] }],
            } as ConsensusSegment);
          const segments = segmentsRun.map((s) =>
            s.segmentId === conflict.segmentId ? conflict : s
          );
          const selectedText =
            conflict.reviewerAnswers && conflict.reviewerAnswers.length > 0
              ? conflict.reviewerAnswers[0].text
              : 'selected';

          const client = makeMockClient();
          client.post.mockResolvedValue({
            ok: true,
            value: {
              data: {
                sessionId,
                segmentId: conflict.segmentId,
                consensusText: selectedText,
                confirmedBy: 'admin',
                confirmedAt: '2024-01-01T00:00:00Z',
              },
            },
          });
          const api = new ConsensusApi(client as unknown as ApiClient);

          const result = await api.resolveConsensus(sessionId, {
            segmentId: conflict.segmentId,
            selectedText,
          });

          // Correct route + body contract.
          expect(client.post).toHaveBeenCalledWith(`/consensus/${sessionId}/resolve`, {
            segmentId: conflict.segmentId,
            selectedText,
          });
          expect(result.ok).toBe(true);

          // Only the resolved segment becomes CONFIRMED; others unchanged.
          const next = applyResolve(segments, conflict.segmentId, selectedText);
          for (const before of segments) {
            const after = next.find((s) => s.segmentId === before.segmentId)!;
            if (before.segmentId === conflict.segmentId) {
              expect(after.consensusStatus).toBe('CONFIRMED');
              expect(after.consensusText).toBe(selectedText);
            } else {
              expect(after.consensusStatus).toBe(before.consensusStatus);
              expect(after.reviewerAnswers).toEqual(before.reviewerAnswers);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * Resolving a non-CONFLICT (UNDECIDED/CONFIRMED) segment: the backend returns
   * VALIDATION_ERROR. The service surfaces it as a Result (ok: false) rather
   * than throwing, and the UI model is left unchanged (no crash).
   */
  it('resolving a non-CONFLICT segment surfaces the error via Result and leaves the UI unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom<ConsensusStatus>('UNDECIDED', 'CONFIRMED'),
        async (sessionId, segmentId, selectedText, nonConflictStatus) => {
          const segments: ConsensusSegment[] = [
            {
              segmentId,
              sessionId,
              startTime: 0,
              endTime: 1,
              originalText: 'original',
              consensusStatus: nonConflictStatus,
              ...(nonConflictStatus === 'CONFIRMED' ? { consensusText: 'kept' } : {}),
            },
          ];

          const client = makeMockClient();
          client.post.mockResolvedValue({
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Segment is not in CONFLICT state',
              statusCode: 400,
            },
          });
          const api = new ConsensusApi(client as unknown as ApiClient);

          const result = await api.resolveConsensus(sessionId, { segmentId, selectedText });

          expect(client.post).toHaveBeenCalledWith(`/consensus/${sessionId}/resolve`, {
            segmentId,
            selectedText,
          });
          // Captured as a Result failure — never thrown.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe('VALIDATION_ERROR');
          }

          // On failure the UI model stays as-is (segment keeps its status).
          const unchanged = result.ok
            ? applyResolve(segments, segmentId, selectedText)
            : segments;
          expect(unchanged[0].consensusStatus).toBe(nonConflictStatus);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1**
   *
   * For any random ConsensusSegment[] returned by the backend, getConsensusSegments
   * calls GET /consensus/{sessionId}/segments and returns the payload unchanged
   * (view path drives the correct route and renders the response).
   */
  it('getConsensusSegments drives GET /consensus/{sessionId}/segments and returns the payload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }).chain((sessionId) =>
          segmentsArb(sessionId).map((segments) => ({ sessionId, segments }))
        ),
        async ({ sessionId, segments }) => {
          const client = makeMockClient();
          client.get.mockResolvedValue({ ok: true, value: { data: segments } });
          const api = new ConsensusApi(client as unknown as ApiClient);

          const result = await api.getConsensusSegments(sessionId);

          expect(client.get).toHaveBeenCalledWith(`/consensus/${sessionId}/segments`);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.data).toEqual(segments);
            // CONFLICT segments carry reviewerAnswers; others do not.
            for (const seg of result.value.data) {
              if (seg.consensusStatus === 'CONFLICT') {
                expect(Array.isArray(seg.reviewerAnswers)).toBe(true);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
