import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createCorrection } from './correction-service.js';
import type { AuthUser } from '../utils/auth-middleware.js';

vi.mock('../repositories/session-repository.js', () => ({
  addParticipant: vi.fn().mockResolvedValue(true),
  getSessionById: vi.fn().mockResolvedValue({
    sessionId: 'session-001',
    name: 'Sample',
    status: 'IN_PROGRESS',
    assignedReviewerCount: 0,
    consensusThreshold: 67,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
}));

vi.mock('../repositories/correction-repository.js', () => ({
  saveCorrection: vi.fn().mockResolvedValue({ saved: true, duplicate: false }),
  updateSessionStatusToInProgress: vi.fn().mockResolvedValue(undefined),
}));

describe('Feature: transcription-review-app, Property 8: CorrectionのISO 8601 UTCタイムスタンプ', () => {
  const mockUser: AuthUser = {
    userId: 'user-001',
    email: 'test@example.com',
    displayName: 'Test User',
    role: 'REVIEWER',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any valid Correction input, the resulting Correction's createdAt field
   * matches the ISO 8601 UTC pattern (YYYY-MM-DDTHH:MM:SS.mmmZ) and is a valid
   * parseable date.
   */
  it('createdAt field must be in ISO 8601 UTC format and parseable as a valid date', async () => {
    const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          correctionId: fc.uuid(),
          segmentId: fc.uuid(),
          correctionType: fc.constantFrom('TEXT' as const, 'SPEAKER' as const, 'SPEAKER_RENAME' as const),
          beforeText: fc.string({ minLength: 0, maxLength: 100 }),
          afterText: fc.string({ minLength: 0, maxLength: 100 }),
        }),
        fc.uuid(),
        async (input, sessionId) => {
          const result = await createCorrection(sessionId, mockUser, input);

          // Verify ISO 8601 UTC format: YYYY-MM-DDTHH:MM:SS.mmmZ
          expect(result.correction.createdAt).toMatch(ISO_8601_UTC_PATTERN);

          // Verify the timestamp is a valid parseable date
          const parsed = new Date(result.correction.createdAt);
          expect(parsed.getTime()).not.toBeNaN();

          // Verify round-trip: parsing and re-serializing yields the same string
          expect(parsed.toISOString()).toBe(result.correction.createdAt);
        }
      ),
      { numRuns: 100 }
    );
  });
});
