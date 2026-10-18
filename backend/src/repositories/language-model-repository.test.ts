import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  putModel,
  getModel,
  queryByTeam,
  queryAll,
  findByDisplayName,
  updateTeamId,
  updateDisplayName,
  setDeletionStatus,
  hardDelete,
} from './language-model-repository.js';
import type { LanguageModelMetadata } from '../types/index.js';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

const sampleModel: LanguageModelMetadata = {
  modelName: 'my-model',
  teamId: 'team-001',
  displayName: '会議モデル',
  displayNameLower: '会議モデル',
  baseModelName: 'WideBand',
  createdBy: 'user-001',
  createdAt: '2024-01-15T10:30:00.000Z',
  sessionIds: ['session-001', 'session-002'],
  s3Key: 'training-data/my-model/training.txt',
  deletionStatus: 'ACTIVE',
};

describe('language-model-repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('putModel', () => {
    it('constructs PK/SK/GSI keys with the LANGUAGEMODEL# SK prefix on GSI1', async () => {
      mockSend.mockResolvedValue({});

      await putModel(sampleModel);

      expect(mockSend).toHaveBeenCalledOnce();
      const input = mockSend.mock.calls[0][0].input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Item.PK).toBe('LANGUAGEMODEL#my-model');
      expect(input.Item.SK).toBe('METADATA');
      expect(input.Item.GSI1PK).toBe('TEAM#team-001');
      // GSI1SK uses a distinct LANGUAGEMODEL# prefix so it cannot collide with
      // MEDIA#/SESSION# items that share the TEAM# partition.
      expect(input.Item.GSI1SK).toBe('LANGUAGEMODEL#my-model');
      expect(input.Item.GSI1SK.startsWith('LANGUAGEMODEL#')).toBe(true);
      expect(input.Item.GSI1SK.startsWith('MEDIA#')).toBe(false);
      expect(input.Item.GSI1SK.startsWith('SESSION#')).toBe(false);
      expect(input.Item.GSI2PK).toBe('TEAM#team-001#DISPLAYNAME');
      expect(input.Item.GSI2SK).toBe('会議モデル');
      expect(input.Item.GSI3PK).toBe('LANGUAGEMODEL');
      expect(input.Item.GSI3SK).toBe('my-model');
      expect(input.Item.entityType).toBe('LanguageModel');
      expect(input.Item.deletionStatus).toBe('ACTIVE');
    });
  });

  describe('getModel', () => {
    it('returns the mapped record when the item exists', async () => {
      mockSend.mockResolvedValue({ Item: { ...sampleModel } });

      const result = await getModel('my-model');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'LANGUAGEMODEL#my-model', SK: 'METADATA' });
      expect(result).toEqual(sampleModel);
    });

    it('returns null when the item does not exist', async () => {
      mockSend.mockResolvedValue({});
      const result = await getModel('missing');
      expect(result).toBeNull();
    });
  });

  describe('queryByTeam', () => {
    it('queries GSI1 with a begins_with on the LANGUAGEMODEL# prefix', async () => {
      mockSend.mockResolvedValue({ Items: [{ ...sampleModel }] });

      const result = await queryByTeam('team-001');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.IndexName).toBe('GSI1');
      expect(input.KeyConditionExpression).toContain('begins_with(GSI1SK, :prefix)');
      expect(input.ExpressionAttributeValues[':pk']).toBe('TEAM#team-001');
      expect(input.ExpressionAttributeValues[':prefix']).toBe('LANGUAGEMODEL#');
      expect(result).toHaveLength(1);
      expect(result[0].modelName).toBe('my-model');
    });
  });

  describe('queryAll', () => {
    it('queries GSI3 with the fixed LANGUAGEMODEL partition', async () => {
      mockSend.mockResolvedValue({ Items: [{ ...sampleModel }] });

      const result = await queryAll();

      const input = mockSend.mock.calls[0][0].input;
      expect(input.IndexName).toBe('GSI3');
      expect(input.ExpressionAttributeValues[':pk']).toBe('LANGUAGEMODEL');
      expect(result).toHaveLength(1);
    });
  });

  describe('findByDisplayName', () => {
    it('queries GSI2 by exact team partition + displayNameLower', async () => {
      mockSend.mockResolvedValue({ Items: [{ ...sampleModel }] });

      const result = await findByDisplayName('team-001', '会議モデル');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.IndexName).toBe('GSI2');
      expect(input.ExpressionAttributeValues[':pk']).toBe('TEAM#team-001#DISPLAYNAME');
      expect(input.ExpressionAttributeValues[':sk']).toBe('会議モデル');
      expect(result?.modelName).toBe('my-model');
    });

    it('returns null when no match is found', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      const result = await findByDisplayName('team-001', 'none');
      expect(result).toBeNull();
    });
  });

  describe('updateTeamId', () => {
    it('rewrites teamId and the dependent GSI1PK/GSI2PK keys', async () => {
      mockSend.mockResolvedValue({});

      await updateTeamId('my-model', 'team-002');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'LANGUAGEMODEL#my-model', SK: 'METADATA' });
      expect(input.ExpressionAttributeValues[':teamId']).toBe('team-002');
      expect(input.ExpressionAttributeValues[':gsi1pk']).toBe('TEAM#team-002');
      expect(input.ExpressionAttributeValues[':gsi2pk']).toBe('TEAM#team-002#DISPLAYNAME');
    });
  });

  describe('updateDisplayName', () => {
    it('rewrites displayName/displayNameLower and GSI2SK', async () => {
      mockSend.mockResolvedValue({});

      await updateDisplayName('my-model', '新しい名前', '新しい名前');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.ExpressionAttributeValues[':displayName']).toBe('新しい名前');
      expect(input.ExpressionAttributeValues[':displayNameLower']).toBe('新しい名前');
      expect(input.ExpressionAttributeValues[':gsi2sk']).toBe('新しい名前');
    });
  });

  describe('setDeletionStatus', () => {
    it('updates the deletionStatus attribute', async () => {
      mockSend.mockResolvedValue({});

      await setDeletionStatus('my-model', 'PENDING');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.ExpressionAttributeValues[':deletionStatus']).toBe('PENDING');
    });
  });

  describe('hardDelete', () => {
    it('deletes the metadata record by key', async () => {
      mockSend.mockResolvedValue({});

      await hardDelete('my-model');

      const input = mockSend.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'LANGUAGEMODEL#my-model', SK: 'METADATA' });
    });
  });
});
