import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsensusApi } from './consensus-api';
import { ApiClient } from './api-client';
import type { ConsensusSegment } from '../types/consensus';

/**
 * Unit tests for ConsensusApi (bugfix: missing-frontend-consensus-and-team-assignment).
 *
 * Verifies that getConsensusSegments / resolveConsensus call the correct
 * path / method / body on the (mocked) ApiClient and return the Result
 * unchanged — covering success, VALIDATION_ERROR, FORBIDDEN and non-editable
 * (COMPLETED session) cases.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */
describe('ConsensusApi', () => {
  let consensusApi: ConsensusApi;
  let mockClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
    };
    consensusApi = new ConsensusApi(mockClient as unknown as ApiClient);
  });

  describe('getConsensusSegments', () => {
    it('calls GET /consensus/{sessionId}/segments and returns the Result', async () => {
      const segments: ConsensusSegment[] = [
        {
          segmentId: 'seg-1',
          sessionId: 'session-1',
          startTime: 0,
          endTime: 1.5,
          originalText: 'こんにちは',
          consensusStatus: 'CONFIRMED',
          consensusText: 'こんにちは',
        },
        {
          segmentId: 'seg-2',
          sessionId: 'session-1',
          startTime: 1.5,
          endTime: 3,
          originalText: 'さようなら',
          consensusStatus: 'CONFLICT',
          reviewerAnswers: [
            { text: 'さようなら', count: 2, userIds: ['u1', 'u2'] },
            { text: 'さよなら', count: 1, userIds: ['u3'] },
          ],
        },
      ];
      mockClient.get.mockResolvedValue({ ok: true, value: { data: segments } });

      const result = await consensusApi.getConsensusSegments('session-1');

      expect(mockClient.get).toHaveBeenCalledWith('/consensus/session-1/segments');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data).toHaveLength(2);
        expect(result.value.data[1].consensusStatus).toBe('CONFLICT');
      }
    });

    it('returns FORBIDDEN error when a non-ADMIN user accesses consensus', async () => {
      mockClient.get.mockResolvedValue({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'この操作を行う権限がありません。',
          statusCode: 403,
        },
      });

      const result = await consensusApi.getConsensusSegments('session-1');

      expect(mockClient.get).toHaveBeenCalledWith('/consensus/session-1/segments');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('resolveConsensus', () => {
    it('calls POST /consensus/{sessionId}/resolve with { segmentId, selectedText }', async () => {
      mockClient.post.mockResolvedValue({
        ok: true,
        value: {
          data: {
            sessionId: 'session-1',
            segmentId: 'seg-2',
            consensusText: 'さようなら',
            confirmedBy: 'admin-1',
            confirmedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      });

      const result = await consensusApi.resolveConsensus('session-1', {
        segmentId: 'seg-2',
        selectedText: 'さようなら',
      });

      expect(mockClient.post).toHaveBeenCalledWith('/consensus/session-1/resolve', {
        segmentId: 'seg-2',
        selectedText: 'さようなら',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data.consensusText).toBe('さようなら');
      }
    });

    it('returns VALIDATION_ERROR when resolving a non-CONFLICT segment', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Segment is not in CONFLICT state',
          statusCode: 400,
        },
      });

      const result = await consensusApi.resolveConsensus('session-1', {
        segmentId: 'seg-1',
        selectedText: 'こんにちは',
      });

      expect(mockClient.post).toHaveBeenCalledWith('/consensus/session-1/resolve', {
        segmentId: 'seg-1',
        selectedText: 'こんにちは',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns the error when the session is not editable (COMPLETED)', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Session is already completed and cannot be edited',
          statusCode: 400,
        },
      });

      const result = await consensusApi.resolveConsensus('session-1', {
        segmentId: 'seg-2',
        selectedText: 'さようなら',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.statusCode).toBe(400);
      }
    });

    it('returns FORBIDDEN when the user is not allowed to resolve', async () => {
      mockClient.post.mockResolvedValue({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'この操作を行う権限がありません。',
          statusCode: 403,
        },
      });

      const result = await consensusApi.resolveConsensus('session-1', {
        segmentId: 'seg-2',
        selectedText: 'さようなら',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });
  });
});
