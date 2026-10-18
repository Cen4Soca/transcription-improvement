import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  updateSessionSpeakerLabels,
  getSegmentSpeakerLabels,
} from './session-repository.js';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

describe('session-repository speaker labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateSessionSpeakerLabels', () => {
    it('writes the labels with a SET UpdateExpression and returns the updated record', async () => {
      mockSend.mockResolvedValue({
        Attributes: {
          sessionId: 'session-001',
          name: 'Session',
          status: 'IN_PROGRESS',
          assignedReviewerCount: 2,
          consensusThreshold: 67,
          speakerLabels: ['spk_0', 'spk_1'],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      });

      const result = await updateSessionSpeakerLabels('session-001', [
        'spk_0',
        'spk_1',
      ]);

      expect(mockSend).toHaveBeenCalledOnce();
      const input = mockSend.mock.calls[0][0].input;
      expect(input.TableName).toBe('TestTable');
      expect(input.Key).toEqual({ PK: 'SESSION#session-001', SK: 'METADATA' });
      expect(input.UpdateExpression).toBe(
        'SET speakerLabels = :labels, updatedAt = :updatedAt'
      );
      expect(input.ExpressionAttributeValues[':labels']).toEqual([
        'spk_0',
        'spk_1',
      ]);
      expect(input.ReturnValues).toBe('ALL_NEW');
      expect(result.speakerLabels).toEqual(['spk_0', 'spk_1']);
    });

    it('persists an empty list when all labels are removed', async () => {
      mockSend.mockResolvedValue({
        Attributes: {
          sessionId: 'session-001',
          name: 'Session',
          status: 'IN_PROGRESS',
          assignedReviewerCount: 2,
          consensusThreshold: 67,
          speakerLabels: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      });

      const result = await updateSessionSpeakerLabels('session-001', []);

      const input = mockSend.mock.calls[0][0].input;
      expect(input.ExpressionAttributeValues[':labels']).toEqual([]);
      expect(result.speakerLabels).toEqual([]);
    });
  });

  describe('getSegmentSpeakerLabels', () => {
    it('queries segments and returns unique labels in first-appearance order', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { speakerLabel: 'spk_0' },
          { speakerLabel: 'spk_1' },
          { speakerLabel: 'spk_0' },
          { speakerLabel: 'spk_2' },
        ],
      });

      const result = await getSegmentSpeakerLabels('session-001');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.KeyConditionExpression).toBe(
        'PK = :pk AND begins_with(SK, :prefix)'
      );
      expect(input.ExpressionAttributeValues).toEqual({
        ':pk': 'SESSION#session-001',
        ':prefix': 'SEGMENT#',
      });
      expect(result).toEqual(['spk_0', 'spk_1', 'spk_2']);
    });

    it('skips segments without a speaker label', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { speakerLabel: 'spk_0' },
          {},
          { speakerLabel: undefined },
          { speakerLabel: 'spk_1' },
        ],
      });

      const result = await getSegmentSpeakerLabels('session-001');

      expect(result).toEqual(['spk_0', 'spk_1']);
    });

    it('returns an empty array when there are no segments', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await getSegmentSpeakerLabels('session-001');

      expect(result).toEqual([]);
    });
  });
});
