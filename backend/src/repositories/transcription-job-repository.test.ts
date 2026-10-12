import { describe, it, expect, vi, beforeEach } from 'vitest';
import { save, getById, getByTranscribeJobName, updateStatus } from './transcription-job-repository.js';
import type { TranscriptionJob } from '../types/transcription-job.js';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

describe('transcription-job-repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleJob: TranscriptionJob = {
    jobId: 'job-001',
    transcribeJobName: 'transcribe-job-abc123',
    mediaFileId: 'media-001',
    status: 'IN_PROGRESS',
    languageCode: 'ja-JP',
    maxSpeakerLabels: 3,
    languageModelName: 'custom-model-v1',
    outputS3Key: undefined,
    sessionId: undefined,
    failureReason: undefined,
    startedBy: 'user-001',
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
  };

  describe('save', () => {
    it('should correctly construct PK/SK/GSI keys and call PutCommand', async () => {
      mockSend.mockResolvedValue({});

      await save(sampleJob);

      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Item.PK).toBe('JOB#job-001');
      expect(input.Item.SK).toBe('METADATA');
      expect(input.Item.GSI1PK).toBe('MEDIA#media-001');
      expect(input.Item.GSI1SK).toBe('JOB#2024-01-15T10:30:00.000Z#job-001');
      expect(input.Item.GSI2PK).toBe('TRANSCRIBE#transcribe-job-abc123');
      expect(input.Item.GSI2SK).toBe('JOB#2024-01-15T10:30:00.000Z');
      expect(input.Item.entityType).toBe('TranscriptionJob');
      expect(input.Item.jobId).toBe('job-001');
      expect(input.Item.transcribeJobName).toBe('transcribe-job-abc123');
      expect(input.Item.mediaFileId).toBe('media-001');
      expect(input.Item.status).toBe('IN_PROGRESS');
      expect(input.Item.languageCode).toBe('ja-JP');
      expect(input.Item.maxSpeakerLabels).toBe(3);
      expect(input.Item.languageModelName).toBe('custom-model-v1');
      expect(input.Item.startedBy).toBe('user-001');
      expect(input.Item.createdAt).toBe('2024-01-15T10:30:00.000Z');
      expect(input.Item.updatedAt).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('getById', () => {
    it('should return TranscriptionJob when found', async () => {
      mockSend.mockResolvedValue({
        Item: {
          PK: 'JOB#job-001',
          SK: 'METADATA',
          jobId: 'job-001',
          transcribeJobName: 'transcribe-job-abc123',
          mediaFileId: 'media-001',
          status: 'IN_PROGRESS',
          languageCode: 'ja-JP',
          maxSpeakerLabels: 3,
          languageModelName: 'custom-model-v1',
          startedBy: 'user-001',
          createdAt: '2024-01-15T10:30:00.000Z',
          updatedAt: '2024-01-15T10:30:00.000Z',
        },
      });

      const result = await getById('job-001');

      expect(result).not.toBeNull();
      expect(result!.jobId).toBe('job-001');
      expect(result!.transcribeJobName).toBe('transcribe-job-abc123');
      expect(result!.status).toBe('IN_PROGRESS');
      expect(result!.languageCode).toBe('ja-JP');
      expect(result!.maxSpeakerLabels).toBe(3);

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Key).toEqual({
        PK: 'JOB#job-001',
        SK: 'METADATA',
      });
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const result = await getById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getByTranscribeJobName', () => {
    it('should query GSI2 with correct key condition', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            jobId: 'job-001',
            transcribeJobName: 'transcribe-job-abc123',
            mediaFileId: 'media-001',
            status: 'COMPLETED',
            languageCode: 'ja-JP',
            maxSpeakerLabels: 3,
            startedBy: 'user-001',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T11:00:00.000Z',
          },
        ],
      });

      const result = await getByTranscribeJobName('transcribe-job-abc123');

      expect(result).not.toBeNull();
      expect(result!.jobId).toBe('job-001');
      expect(result!.transcribeJobName).toBe('transcribe-job-abc123');

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.IndexName).toBe('GSI2');
      expect(input.KeyConditionExpression).toBe('GSI2PK = :gsi2pk AND begins_with(GSI2SK, :prefix)');
      expect(input.ExpressionAttributeValues[':gsi2pk']).toBe('TRANSCRIBE#transcribe-job-abc123');
      expect(input.ExpressionAttributeValues[':prefix']).toBe('JOB#');
      expect(input.Limit).toBe(1);
    });

    it('should return null when no items match', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await getByTranscribeJobName('non-existent-job');

      expect(result).toBeNull();
    });

    it('should return null when Items is undefined', async () => {
      mockSend.mockResolvedValue({});

      const result = await getByTranscribeJobName('non-existent-job');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should call UpdateCommand with correct expression (without failureReason)', async () => {
      mockSend.mockResolvedValue({});

      await updateStatus('job-001', 'COMPLETED');

      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Key).toEqual({
        PK: 'JOB#job-001',
        SK: 'METADATA',
      });
      expect(input.UpdateExpression).toBe('SET #status = :status, updatedAt = :updatedAt');
      expect(input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
      expect(input.ExpressionAttributeValues[':status']).toBe('COMPLETED');
      expect(input.ExpressionAttributeValues[':updatedAt']).toBeDefined();
      expect(input.ExpressionAttributeValues[':failureReason']).toBeUndefined();
    });

    it('should call UpdateCommand with failureReason when provided', async () => {
      mockSend.mockResolvedValue({});

      await updateStatus('job-001', 'FAILED', 'Transcription service error');

      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Key).toEqual({
        PK: 'JOB#job-001',
        SK: 'METADATA',
      });
      expect(input.UpdateExpression).toBe(
        'SET #status = :status, updatedAt = :updatedAt, failureReason = :failureReason'
      );
      expect(input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
      expect(input.ExpressionAttributeValues[':status']).toBe('FAILED');
      expect(input.ExpressionAttributeValues[':failureReason']).toBe('Transcription service error');
      expect(input.ExpressionAttributeValues[':updatedAt']).toBeDefined();
    });
  });
});
