import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveCorrection,
  updateSessionStatusToInProgress,
  hasExistingCorrections,
  type CorrectionRecord,
} from './correction-repository.js';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

describe('correction-repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleRecord: CorrectionRecord = {
    correctionId: 'corr-001',
    sessionId: 'session-001',
    segmentId: 'seg-001',
    userId: 'user-001',
    correctionType: 'TEXT',
    beforeText: 'original',
    afterText: 'corrected',
    createdAt: '2024-01-15T10:30:00.000Z',
  };

  describe('saveCorrection', () => {
    it('should save correction with correct key structure', async () => {
      mockSend.mockResolvedValue({});

      const result = await saveCorrection(sampleRecord);

      expect(result).toEqual({ saved: true, duplicate: false });
      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Item.PK).toBe('SESSION#session-001#USER#user-001');
      expect(input.Item.SK).toBe('CORRECTION#2024-01-15T10:30:00.000Z#corr-001');
      expect(input.Item.GSI1PK).toBe('SEGMENT#seg-001');
      expect(input.Item.GSI1SK).toBe('CORRECTION#2024-01-15T10:30:00.000Z');
      expect(input.Item.entityType).toBe('Correction');
      expect(input.Item.correctionId).toBe('corr-001');
      expect(input.Item.correctionType).toBe('TEXT');
      expect(input.ConditionExpression).toBe(
        'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      );
    });

    it('should return duplicate true on ConditionalCheckFailedException', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValue(error);

      const result = await saveCorrection(sampleRecord);

      expect(result).toEqual({ saved: false, duplicate: true });
    });

    it('should throw on other DynamoDB errors', async () => {
      mockSend.mockRejectedValue(new Error('Service unavailable'));

      await expect(saveCorrection(sampleRecord)).rejects.toThrow('Service unavailable');
    });

    it('should include optional fields when provided', async () => {
      mockSend.mockResolvedValue({});

      const recordWithOptional: CorrectionRecord = {
        ...sampleRecord,
        correctionType: 'SPEAKER_RENAME',
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'Tanaka',
        affectedSegmentCount: 5,
      };

      await saveCorrection(recordWithOptional);

      const command = mockSend.mock.calls[0][0];
      const item = command.input.Item;

      expect(item.beforeSpeaker).toBe('spk_0');
      expect(item.afterSpeaker).toBe('Tanaka');
      expect(item.affectedSegmentCount).toBe(5);
    });
  });

  describe('updateSessionStatusToInProgress', () => {
    it('should update session status with correct key and condition', async () => {
      mockSend.mockResolvedValue({});

      await updateSessionStatusToInProgress('session-001');

      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Key).toEqual({
        PK: 'SESSION#session-001',
        SK: 'METADATA',
      });
      expect(input.ConditionExpression).toBe('#status = :pendingStatus');
      expect(input.ExpressionAttributeValues[':newStatus']).toBe('IN_PROGRESS');
      expect(input.ExpressionAttributeValues[':pendingStatus']).toBe('PENDING');
    });

    it('should silently succeed on ConditionalCheckFailedException (already in progress)', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValue(error);

      await expect(
        updateSessionStatusToInProgress('session-001')
      ).resolves.toBeUndefined();
    });

    it('should throw on other DynamoDB errors', async () => {
      mockSend.mockRejectedValue(new Error('Throttled'));

      await expect(
        updateSessionStatusToInProgress('session-001')
      ).rejects.toThrow('Throttled');
    });
  });

  describe('hasExistingCorrections', () => {
    it('should return true when corrections exist', async () => {
      mockSend.mockResolvedValue({ Items: [{ PK: 'test' }] });

      const result = await hasExistingCorrections('session-001', 'user-001');

      expect(result).toBe(true);

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :prefix)');
      expect(input.ExpressionAttributeValues[':pk']).toBe('SESSION#session-001#USER#user-001');
      expect(input.ExpressionAttributeValues[':prefix']).toBe('CORRECTION#');
      expect(input.Limit).toBe(1);
    });

    it('should return false when no corrections exist', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await hasExistingCorrections('session-001', 'user-001');

      expect(result).toBe(false);
    });

    it('should return false when Items is undefined', async () => {
      mockSend.mockResolvedValue({});

      const result = await hasExistingCorrections('session-001', 'user-001');

      expect(result).toBe(false);
    });
  });
});
