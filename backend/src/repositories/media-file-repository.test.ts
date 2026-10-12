import { describe, it, expect, vi, beforeEach } from 'vitest';
import { save, getById, getBySessionId, deleteById, listByTeam } from './media-file-repository.js';
import type { MediaFile } from '../types/media-file.js';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

describe('media-file-repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleMediaFile: MediaFile = {
    mediaFileId: 'media-001',
    filename: 'meeting.mp3',
    s3Key: 'media/media-001/meeting.mp3',
    contentType: 'audio/mpeg',
    fileSize: 1024000,
    uploadedBy: 'user-001',
    teamId: 'team-001',
    status: 'UPLOADED',
    sessionId: 'session-001',
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
  };

  describe('save', () => {
    it('should correctly construct PK/SK/GSI keys and call PutCommand', async () => {
      mockSend.mockResolvedValue({});

      await save(sampleMediaFile);

      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Item.PK).toBe('MEDIA#media-001');
      expect(input.Item.SK).toBe('METADATA');
      expect(input.Item.GSI1PK).toBe('TEAM#team-001');
      expect(input.Item.GSI1SK).toBe('MEDIA#2024-01-15T10:30:00.000Z#media-001');
      expect(input.Item.GSI2PK).toBe('USER#user-001');
      expect(input.Item.GSI2SK).toBe('MEDIA#2024-01-15T10:30:00.000Z#media-001');
      expect(input.Item.entityType).toBe('MediaFile');
      expect(input.Item.mediaFileId).toBe('media-001');
      expect(input.Item.filename).toBe('meeting.mp3');
      expect(input.Item.s3Key).toBe('media/media-001/meeting.mp3');
      expect(input.Item.contentType).toBe('audio/mpeg');
      expect(input.Item.fileSize).toBe(1024000);
      expect(input.Item.uploadedBy).toBe('user-001');
      expect(input.Item.status).toBe('UPLOADED');
    });

    it('should not set GSI1 keys when teamId is undefined', async () => {
      mockSend.mockResolvedValue({});

      const recordWithoutTeam: MediaFile = {
        ...sampleMediaFile,
        teamId: undefined,
      };

      await save(recordWithoutTeam);

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.Item.GSI1PK).toBeUndefined();
      expect(input.Item.GSI1SK).toBeUndefined();
      // GSI2 should still be set
      expect(input.Item.GSI2PK).toBe('USER#user-001');
      expect(input.Item.GSI2SK).toBe('MEDIA#2024-01-15T10:30:00.000Z#media-001');
    });
  });

  describe('getById', () => {
    it('should return MediaFile when found', async () => {
      mockSend.mockResolvedValue({
        Item: {
          PK: 'MEDIA#media-001',
          SK: 'METADATA',
          mediaFileId: 'media-001',
          filename: 'meeting.mp3',
          s3Key: 'media/media-001/meeting.mp3',
          contentType: 'audio/mpeg',
          fileSize: 1024000,
          uploadedBy: 'user-001',
          teamId: 'team-001',
          status: 'UPLOADED',
          sessionId: 'session-001',
          createdAt: '2024-01-15T10:30:00.000Z',
          updatedAt: '2024-01-15T10:30:00.000Z',
        },
      });

      const result = await getById('media-001');

      expect(result).not.toBeNull();
      expect(result!.mediaFileId).toBe('media-001');
      expect(result!.filename).toBe('meeting.mp3');
      expect(result!.status).toBe('UPLOADED');

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Key).toEqual({
        PK: 'MEDIA#media-001',
        SK: 'METADATA',
      });
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const result = await getById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('should return MediaFile matching sessionId via Scan', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            mediaFileId: 'media-001',
            filename: 'meeting.mp3',
            s3Key: 'media/media-001/meeting.mp3',
            contentType: 'audio/mpeg',
            fileSize: 1024000,
            uploadedBy: 'user-001',
            teamId: 'team-001',
            status: 'COMPLETED',
            sessionId: 'session-001',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z',
          },
        ],
      });

      const result = await getBySessionId('session-001');

      expect(result).not.toBeNull();
      expect(result!.mediaFileId).toBe('media-001');
      expect(result!.sessionId).toBe('session-001');

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.FilterExpression).toBe('entityType = :entityType AND sessionId = :sessionId');
      expect(input.ExpressionAttributeValues[':entityType']).toBe('MediaFile');
      expect(input.ExpressionAttributeValues[':sessionId']).toBe('session-001');
    });

    it('should return null when no items match', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await getBySessionId('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when Items is undefined', async () => {
      mockSend.mockResolvedValue({});

      const result = await getBySessionId('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('deleteById', () => {
    it('should call DeleteCommand with correct key', async () => {
      mockSend.mockResolvedValue({});

      await deleteById('media-001');

      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Key).toEqual({
        PK: 'MEDIA#media-001',
        SK: 'METADATA',
      });
    });
  });

  describe('listByTeam', () => {
    it('should query GSI1 with correct key condition', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            mediaFileId: 'media-001',
            filename: 'meeting.mp3',
            s3Key: 'media/media-001/meeting.mp3',
            contentType: 'audio/mpeg',
            fileSize: 1024000,
            uploadedBy: 'user-001',
            teamId: 'team-001',
            status: 'UPLOADED',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z',
          },
          {
            mediaFileId: 'media-002',
            filename: 'interview.wav',
            s3Key: 'media/media-002/interview.wav',
            contentType: 'audio/wav',
            fileSize: 2048000,
            uploadedBy: 'user-002',
            teamId: 'team-001',
            status: 'COMPLETED',
            createdAt: '2024-01-16T10:30:00.000Z',
            updatedAt: '2024-01-16T10:30:00.000Z',
          },
        ],
      });

      const result = await listByTeam('team-001');

      expect(result).toHaveLength(2);
      expect(result[0].mediaFileId).toBe('media-001');
      expect(result[1].mediaFileId).toBe('media-002');

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.IndexName).toBe('GSI1');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)');
      expect(input.ExpressionAttributeValues[':gsi1pk']).toBe('TEAM#team-001');
      expect(input.ExpressionAttributeValues[':prefix']).toBe('MEDIA#');
      expect(input.ScanIndexForward).toBe(false);
    });

    it('should return empty array when no items found', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await listByTeam('team-empty');

      expect(result).toEqual([]);
    });

    it('should return empty array when Items is undefined', async () => {
      mockSend.mockResolvedValue({});

      const result = await listByTeam('team-empty');

      expect(result).toEqual([]);
    });
  });
});
