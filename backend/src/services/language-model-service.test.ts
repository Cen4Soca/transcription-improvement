import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  createModel,
  listModels,
  getModelStatus,
  renameModelDisplayName,
  changeModelTeam,
  deleteModel,
  setTranscribeClient,
  setS3Client,
  setDeleteBackoffBaseMs,
  checkRoleAccess,
  generateTrainingData,
  type CreateModelParams,
} from './language-model-service.js';
import type { AuthUser } from '../utils/auth-middleware.js';

vi.mock('./audit-service.js', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repositories/team-repository.js', () => ({
  getTeamById: vi.fn(),
}));

vi.mock('./access-control-service.js', () => ({
  checkSessionAccess: vi.fn().mockResolvedValue(undefined),
  checkLanguageModelAccess: vi.fn(),
  isTeamMember: vi.fn().mockResolvedValue(true),
  getUserTeamIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repositories/language-model-repository.js', () => ({
  putModel: vi.fn().mockResolvedValue(undefined),
  getModel: vi.fn().mockResolvedValue(null),
  findByDisplayName: vi.fn().mockResolvedValue(null),
  updateDisplayName: vi.fn().mockResolvedValue(undefined),
  updateTeamId: vi.fn().mockResolvedValue(undefined),
  setDeletionStatus: vi.fn().mockResolvedValue(undefined),
  hardDelete: vi.fn().mockResolvedValue(undefined),
  queryByTeam: vi.fn().mockResolvedValue([]),
  queryAll: vi.fn().mockResolvedValue([]),
}));

import { recordAuditLog } from './audit-service.js';
import { getTeamById } from '../repositories/team-repository.js';
import {
  checkSessionAccess,
  checkLanguageModelAccess,
  isTeamMember,
  getUserTeamIds,
} from './access-control-service.js';
import {
  putModel,
  getModel,
  findByDisplayName,
  updateDisplayName,
  updateTeamId,
  setDeletionStatus,
  hardDelete,
  queryByTeam,
  queryAll,
} from '../repositories/language-model-repository.js';
import type { LanguageModelMetadata } from '../types/index.js';

const mockedRecordAuditLog = vi.mocked(recordAuditLog);
const mockedGetTeamById = vi.mocked(getTeamById);
const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedCheckLanguageModelAccess = vi.mocked(checkLanguageModelAccess);
const mockedIsTeamMember = vi.mocked(isTeamMember);
const mockedGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockedPutModel = vi.mocked(putModel);
const mockedGetModel = vi.mocked(getModel);
const mockedFindByDisplayName = vi.mocked(findByDisplayName);
const mockedUpdateDisplayName = vi.mocked(updateDisplayName);
const mockedUpdateTeamId = vi.mocked(updateTeamId);
const mockedSetDeletionStatus = vi.mocked(setDeletionStatus);
const mockedHardDelete = vi.mocked(hardDelete);
const mockedQueryByTeam = vi.mocked(queryByTeam);
const mockedQueryAll = vi.mocked(queryAll);

function buildMetadata(
  overrides: Partial<LanguageModelMetadata> = {}
): LanguageModelMetadata {
  return {
    modelName: 'model-x',
    teamId: 'team-001',
    displayName: 'Model X',
    displayNameLower: 'model x',
    baseModelName: 'WideBand',
    createdBy: 'user-001',
    createdAt: '2024-01-01T00:00:00.000Z',
    sessionIds: [],
    s3Key: 'training-data/model-x/training.txt',
    deletionStatus: 'ACTIVE',
    ...overrides,
  };
}

const adminUser: AuthUser = {
  userId: 'user-001',
  email: 'admin@example.com',
  displayName: 'Admin User',
  role: 'ADMIN',
};

const leaderUser: AuthUser = {
  userId: 'leader-001',
  email: 'leader@example.com',
  displayName: 'Leader User',
  role: 'TEAM_LEADER',
};

const reviewerUser: AuthUser = {
  userId: 'reviewer-001',
  email: 'reviewer@example.com',
  displayName: 'Reviewer User',
  role: 'REVIEWER',
};

function buildCreateParams(
  overrides: Partial<CreateModelParams> = {}
): CreateModelParams {
  return {
    modelName: 'my-model',
    baseModelName: 'WideBand',
    displayName: '会議モデル',
    teamId: 'team-001',
    segments: [{ text: 'テスト文章', confirmed: true }],
    sessionIds: ['session-001'],
    user: adminUser,
    ...overrides,
  };
}

describe('LanguageModelService', () => {
  const mockTranscribeSend = vi.fn();
  const mockS3Send = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
    vi.stubEnv('TRANSCRIBE_DATA_ACCESS_ROLE_ARN', 'arn:aws:iam::123456789012:role/TranscribeDataAccess');

    setTranscribeClient({ send: mockTranscribeSend } as any);
    setS3Client({ send: mockS3Send } as any);

    // Default: no duplicate models
    mockTranscribeSend.mockResolvedValue({ Models: [] });
    mockS3Send.mockResolvedValue({});

    // Default team / access-control / repository behavior
    mockedGetTeamById.mockResolvedValue({
      teamId: 'team-001',
      name: 'Team 1',
      createdBy: 'admin-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    mockedCheckSessionAccess.mockResolvedValue(undefined);
    mockedIsTeamMember.mockResolvedValue(true);
    mockedFindByDisplayName.mockResolvedValue(null);
    mockedPutModel.mockResolvedValue(undefined);
    mockedGetModel.mockResolvedValue(null);
    mockedUpdateTeamId.mockResolvedValue(undefined);
    mockedSetDeletionStatus.mockResolvedValue(undefined);
    mockedHardDelete.mockResolvedValue(undefined);
    mockedGetUserTeamIds.mockResolvedValue([]);
    mockedQueryByTeam.mockResolvedValue([]);
    mockedQueryAll.mockResolvedValue([]);

    // Zero the delete backoff so retry tests do not incur real delays.
    setDeleteBackoffBaseMs(0);
  });

  // --- createModel tests ---

  describe('createModel', () => {
    test('calls Transcribe CreateLanguageModel with correct parameters', async () => {
      // First call: ListLanguageModels (duplicate check) → no duplicates
      // Second call: CreateLanguageModel
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      await createModel(buildCreateParams());

      // Second call should be CreateLanguageModel
      expect(mockTranscribeSend).toHaveBeenCalledTimes(2);
      const createCommand = mockTranscribeSend.mock.calls[1][0];
      expect(createCommand.input).toMatchObject({
        ModelName: 'my-model',
        BaseModelName: 'WideBand',
        InputDataConfig: {
          S3Uri: 's3://test-data-bucket/training-data/my-model/training.txt',
          DataAccessRoleArn: 'arn:aws:iam::123456789012:role/TranscribeDataAccess',
        },
        LanguageCode: 'ja-JP',
      });
    });

    test('persists metadata via putModel with deletionStatus ACTIVE', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      await createModel(buildCreateParams());

      expect(mockedPutModel).toHaveBeenCalledTimes(1);
      expect(mockedPutModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'my-model',
          teamId: 'team-001',
          displayName: '会議モデル',
          displayNameLower: '会議モデル',
          deletionStatus: 'ACTIVE',
          s3Key: 'training-data/my-model/training.txt',
        })
      );
    });

    test('uploads training data to S3 at correct path', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      await createModel(
        buildCreateParams({
          modelName: 'custom-model',
          baseModelName: 'NarrowBand',
          segments: [
            { text: '確定済みテキスト1', confirmed: true },
            { text: '確定済みテキスト2', confirmed: true },
          ],
          sessionIds: ['session-001', 'session-002'],
          user: leaderUser,
        })
      );

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const s3Command = mockS3Send.mock.calls[0][0];
      expect(s3Command.input).toMatchObject({
        Bucket: 'test-data-bucket',
        Key: 'training-data/custom-model/training.txt',
        Body: '確定済みテキスト1\n確定済みテキスト2',
        ContentType: 'text/plain',
      });
    });

    test('rejects when user role is REVIEWER (403)', async () => {
      await expect(
        createModel(buildCreateParams({ user: reviewerUser }))
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    });

    test('rejects when the target team does not exist (400)', async () => {
      mockedGetTeamById.mockResolvedValue(null);

      await expect(
        createModel(buildCreateParams({ teamId: 'missing-team' }))
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('rejects non-ADMIN when not a member of the target team (403)', async () => {
      mockedIsTeamMember.mockResolvedValue(false);

      await expect(
        createModel(buildCreateParams({ user: leaderUser }))
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    });

    test('rejects when displayName duplicates within the team (400)', async () => {
      mockedFindByDisplayName.mockResolvedValue({
        modelName: 'other-model',
        teamId: 'team-001',
        displayName: '会議モデル',
        displayNameLower: '会議モデル',
        baseModelName: 'WideBand',
        createdBy: 'user-002',
        createdAt: '2024-01-01T00:00:00.000Z',
        sessionIds: [],
        s3Key: 'training-data/other-model/training.txt',
        deletionStatus: 'ACTIVE',
      });

      await expect(
        createModel(buildCreateParams())
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('rejects when model name is duplicate', async () => {
      mockTranscribeSend.mockResolvedValueOnce({
        Models: [{ ModelName: 'existing-model' }],
      });

      await expect(
        createModel(buildCreateParams({ modelName: 'existing-model' }))
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('rejects when no confirmed segments (empty training data)', async () => {
      mockTranscribeSend.mockResolvedValueOnce({ Models: [] });

      await expect(
        createModel(
          buildCreateParams({
            segments: [{ text: '未確定テキスト', confirmed: false }],
          })
        )
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('maps Transcribe LimitExceeded to QUOTA_EXCEEDED (429)', async () => {
      const limitError = Object.assign(new Error('model limit reached'), {
        name: 'LimitExceededException',
      });
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockRejectedValueOnce(limitError);

      await expect(
        createModel(buildCreateParams())
      ).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
        statusCode: 429,
      });

      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    test('records AuditLog with teamId and displayName on success', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      await createModel(
        buildCreateParams({
          modelName: 'audit-test-model',
          user: adminUser,
          sessionIds: ['session-001', 'session-002'],
        })
      );

      expect(mockedRecordAuditLog).toHaveBeenCalledTimes(1);
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-001',
          actorRole: 'ADMIN',
          operationType: 'LANGUAGE_MODEL_CREATED',
          resourceId: 'audit-test-model',
          resourceType: 'LanguageModel',
          metadata: {
            baseModelName: 'WideBand',
            teamId: 'team-001',
            displayName: '会議モデル',
            sessionIds: 'session-001,session-002',
          },
        })
      );
    });

    test('does not record AuditLog when role check fails', async () => {
      await expect(
        createModel(buildCreateParams({ user: reviewerUser }))
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });
  });

  // --- Role check tests (Req 20.1, 20.2) ---

  describe('checkRoleAccess', () => {
    test('allows ADMIN role', () => {
      expect(checkRoleAccess('ADMIN')).toBe(true);
    });

    test('allows TEAM_LEADER role', () => {
      expect(checkRoleAccess('TEAM_LEADER')).toBe(true);
    });

    test('rejects REVIEWER role', () => {
      expect(checkRoleAccess('REVIEWER')).toBe(false);
    });

    test('rejects unknown roles', () => {
      expect(checkRoleAccess('UNKNOWN')).toBe(false);
      expect(checkRoleAccess('')).toBe(false);
    });
  });

  describe('createModel - role access', () => {
    test('ADMIN can create a model successfully', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      const result = await createModel(
        buildCreateParams({ modelName: 'admin-model', user: adminUser })
      );

      expect(result.modelName).toBe('admin-model');
      expect(result.status).toBe('IN_PROGRESS');
    });

    test('TEAM_LEADER can create a model successfully', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      const result = await createModel(
        buildCreateParams({
          modelName: 'leader-model',
          baseModelName: 'NarrowBand',
          user: leaderUser,
        })
      );

      expect(result.modelName).toBe('leader-model');
      expect(result.status).toBe('IN_PROGRESS');
    });
  });

  // --- Model name duplicate tests (Req 20.11) ---

  describe('createModel - model name duplicate detection', () => {
    test('rejects exact case-sensitive match', async () => {
      mockTranscribeSend.mockResolvedValueOnce({
        Models: [{ ModelName: 'MyModel' }],
      });

      await expect(
        createModel(buildCreateParams({ modelName: 'MyModel' }))
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('allows model name with different case (case-sensitive)', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [{ ModelName: 'MyModel' }] })
        .mockResolvedValueOnce({});

      const result = await createModel(buildCreateParams({ modelName: 'mymodel' }));

      expect(result.modelName).toBe('mymodel');
    });

    test('allows model name when no existing models', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      const result = await createModel(
        buildCreateParams({ modelName: 'brand-new-model' })
      );

      expect(result.modelName).toBe('brand-new-model');
    });
  });

  // --- Training data generation tests (Req 20.9) ---

  describe('generateTrainingData', () => {
    test('includes only confirmed segments', () => {
      const segments = [
        { text: '確定テキスト1', confirmed: true },
        { text: '未確定テキスト', confirmed: false },
        { text: '確定テキスト2', confirmed: true },
      ];

      const result = generateTrainingData(segments);
      expect(result).toBe('確定テキスト1\n確定テキスト2');
    });

    test('returns empty string when no confirmed segments', () => {
      const segments = [
        { text: '未確定1', confirmed: false },
        { text: '未確定2', confirmed: false },
      ];

      const result = generateTrainingData(segments);
      expect(result).toBe('');
    });

    test('returns single segment text without newline', () => {
      const segments = [{ text: '唯一の確定テキスト', confirmed: true }];

      const result = generateTrainingData(segments);
      expect(result).toBe('唯一の確定テキスト');
    });

    test('returns empty string for empty segments array', () => {
      const result = generateTrainingData([]);
      expect(result).toBe('');
    });
  });

  // --- API error handling tests (Req 20.9) ---

  describe('createModel - API error handling', () => {
    test('propagates Transcribe ListLanguageModels API error', async () => {
      mockTranscribeSend.mockRejectedValueOnce(
        new Error('Transcribe service unavailable')
      );

      await expect(
        createModel(buildCreateParams())
      ).rejects.toThrow('Transcribe service unavailable');
    });

    test('propagates S3 PutObject API error', async () => {
      mockTranscribeSend.mockResolvedValueOnce({ Models: [] });
      mockS3Send.mockRejectedValueOnce(
        new Error('S3 access denied')
      );

      await expect(
        createModel(buildCreateParams())
      ).rejects.toThrow('S3 access denied');
    });

    test('propagates Transcribe CreateLanguageModel API error', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockRejectedValueOnce(new Error('CreateLanguageModel failed'));
      mockS3Send.mockResolvedValueOnce({});

      await expect(
        createModel(buildCreateParams())
      ).rejects.toThrow('CreateLanguageModel failed');
    });

    test('does not record AuditLog when Transcribe API fails', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockRejectedValueOnce(new Error('Transcribe error'));
      mockS3Send.mockResolvedValueOnce({});

      await expect(
        createModel(buildCreateParams())
      ).rejects.toThrow();

      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    test('does not record AuditLog when S3 upload fails', async () => {
      mockTranscribeSend.mockResolvedValueOnce({ Models: [] });
      mockS3Send.mockRejectedValueOnce(new Error('S3 error'));

      await expect(
        createModel(buildCreateParams())
      ).rejects.toThrow();

      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });
  });

  // --- listModels tests ---

  describe('listModels', () => {
    test('ADMIN sees the intersection of all metadata and Transcribe COMPLETED models', async () => {
      // ADMIN metadata set (GSI3 queryAll): model-a, model-c, model-x
      mockedQueryAll.mockResolvedValue([
        buildMetadata({ modelName: 'model-a', teamId: 'team-1', displayName: 'A' }),
        buildMetadata({ modelName: 'model-c', teamId: 'team-2', displayName: 'C' }),
        buildMetadata({ modelName: 'model-x', teamId: 'team-3', displayName: 'X' }),
      ]);

      // Transcribe: model-a COMPLETED, model-b COMPLETED (no metadata), model-c IN_PROGRESS
      mockTranscribeSend.mockResolvedValue({
        Models: [
          { ModelName: 'model-a', ModelStatus: 'COMPLETED', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-01') },
          { ModelName: 'model-b', ModelStatus: 'COMPLETED', BaseModelName: 'NarrowBand', CreateTime: new Date('2024-01-02') },
          { ModelName: 'model-c', ModelStatus: 'IN_PROGRESS', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-03') },
        ],
      });

      const result = await listModels(adminUser);

      // Only model-a is in BOTH the metadata set AND Transcribe COMPLETED.
      expect(result).toHaveLength(1);
      expect(result[0].modelName).toBe('model-a');
      expect(result[0].modelStatus).toBe('COMPLETED');
      expect(result[0].displayName).toBe('A');
      expect(result[0].teamId).toBe('team-1');
      expect(mockedQueryAll).toHaveBeenCalledTimes(1);
    });

    test('non-ADMIN sees only their teams metadata intersected with COMPLETED', async () => {
      mockedGetUserTeamIds.mockResolvedValue(['team-1']);
      mockedQueryByTeam.mockResolvedValue([
        buildMetadata({ modelName: 'model-a', teamId: 'team-1', displayName: 'A' }),
      ]);

      mockTranscribeSend.mockResolvedValue({
        Models: [
          { ModelName: 'model-a', ModelStatus: 'COMPLETED', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-01') },
          { ModelName: 'model-other', ModelStatus: 'COMPLETED', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-02') },
        ],
      });

      const result = await listModels(leaderUser);

      expect(result).toHaveLength(1);
      expect(result[0].modelName).toBe('model-a');
      expect(mockedQueryByTeam).toHaveBeenCalledWith('team-1');
      expect(mockedQueryAll).not.toHaveBeenCalled();
    });

    test('excludes PENDING (soft-deleted) metadata even if COMPLETED in Transcribe', async () => {
      mockedQueryAll.mockResolvedValue([
        buildMetadata({ modelName: 'model-a', deletionStatus: 'PENDING' }),
      ]);
      mockTranscribeSend.mockResolvedValue({
        Models: [
          { ModelName: 'model-a', ModelStatus: 'COMPLETED', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-01') },
        ],
      });

      const result = await listModels(adminUser);
      expect(result).toHaveLength(0);
    });

    test('returns empty when a non-ADMIN belongs to no team', async () => {
      mockedGetUserTeamIds.mockResolvedValue([]);
      mockTranscribeSend.mockResolvedValue({
        Models: [
          { ModelName: 'model-a', ModelStatus: 'COMPLETED', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-01') },
        ],
      });

      const result = await listModels(reviewerUser);
      expect(result).toHaveLength(0);
      expect(mockedQueryByTeam).not.toHaveBeenCalled();
    });
  });

  // --- getModelStatus tests ---

  describe('getModelStatus', () => {
    test('returns model status from Transcribe API', async () => {
      mockTranscribeSend.mockResolvedValue({
        LanguageModel: {
          ModelName: 'my-model',
          ModelStatus: 'COMPLETED',
          BaseModelName: 'WideBand',
          FailureReason: undefined,
        },
      });

      const result = await getModelStatus('my-model');

      expect(result).toEqual({
        modelName: 'my-model',
        modelStatus: 'COMPLETED',
        baseModelName: 'WideBand',
        failureReason: undefined,
      });
    });

    test('throws NOT_FOUND when model does not exist', async () => {
      mockTranscribeSend.mockResolvedValue({
        LanguageModel: undefined,
      });

      await expect(getModelStatus('nonexistent-model')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });
    });
  });

  // --- renameModelDisplayName tests ---

  describe('renameModelDisplayName', () => {
    test('TEAM_LEADER renames to a unique name and persists displayName', async () => {
      mockedCheckLanguageModelAccess.mockResolvedValue(buildMetadata());
      mockedFindByDisplayName.mockResolvedValue(null);

      const result = await renameModelDisplayName(leaderUser, 'model-x', '新しい表示名');

      expect(result.displayName).toBe('新しい表示名');
      expect(result.displayNameLower).toBe('新しい表示名');
      expect(mockedFindByDisplayName).toHaveBeenCalledWith('team-001', '新しい表示名');
      expect(mockedUpdateDisplayName).toHaveBeenCalledWith(
        'model-x',
        '新しい表示名',
        '新しい表示名'
      );
    });

    test('trims the raw name before validating and persisting', async () => {
      mockedCheckLanguageModelAccess.mockResolvedValue(buildMetadata());
      mockedFindByDisplayName.mockResolvedValue(null);

      const result = await renameModelDisplayName(adminUser, 'model-x', '  会議モデル  ');

      expect(result.displayName).toBe('会議モデル');
      expect(mockedUpdateDisplayName).toHaveBeenCalledWith(
        'model-x',
        '会議モデル',
        '会議モデル'
      );
    });

    test('allows renaming to the same name (self excluded from uniqueness)', async () => {
      const self = buildMetadata({
        modelName: 'model-x',
        displayName: 'Model X',
        displayNameLower: 'model x',
      });
      mockedCheckLanguageModelAccess.mockResolvedValue(self);
      // Uniqueness lookup returns the model itself.
      mockedFindByDisplayName.mockResolvedValue(self);

      const result = await renameModelDisplayName(adminUser, 'model-x', 'Model X');

      expect(result.displayName).toBe('Model X');
      expect(mockedUpdateDisplayName).toHaveBeenCalledTimes(1);
    });

    test('rejects when another model in the team uses the name (400)', async () => {
      mockedCheckLanguageModelAccess.mockResolvedValue(
        buildMetadata({ modelName: 'model-x' })
      );
      mockedFindByDisplayName.mockResolvedValue(
        buildMetadata({ modelName: 'other-model', displayName: 'Taken', displayNameLower: 'taken' })
      );

      await expect(
        renameModelDisplayName(adminUser, 'model-x', 'Taken')
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

      expect(mockedUpdateDisplayName).not.toHaveBeenCalled();
    });

    test('rejects REVIEWER with 403', async () => {
      mockedCheckLanguageModelAccess.mockResolvedValue(buildMetadata());

      await expect(
        renameModelDisplayName(reviewerUser, 'model-x', '新しい名前')
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

      expect(mockedUpdateDisplayName).not.toHaveBeenCalled();
    });

    test('rejects a whitespace-only name (400)', async () => {
      mockedCheckLanguageModelAccess.mockResolvedValue(buildMetadata());

      await expect(
        renameModelDisplayName(adminUser, 'model-x', '   ')
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

      expect(mockedUpdateDisplayName).not.toHaveBeenCalled();
    });

    test('rejects a name longer than 100 characters (400)', async () => {
      mockedCheckLanguageModelAccess.mockResolvedValue(buildMetadata());

      await expect(
        renameModelDisplayName(adminUser, 'model-x', 'a'.repeat(101))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

      expect(mockedUpdateDisplayName).not.toHaveBeenCalled();
    });

    test('propagates 404 when the model is inaccessible', async () => {
      const { AppError } = await import('../utils/error-handler.js');
      mockedCheckLanguageModelAccess.mockRejectedValue(
        new AppError({
          code: 'NOT_FOUND',
          message: 'リソースが見つかりません。',
          statusCode: 404,
        })
      );

      await expect(
        renameModelDisplayName(leaderUser, 'other-team-model', '新しい名前')
      ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

      expect(mockedUpdateDisplayName).not.toHaveBeenCalled();
    });
  });

  // --- changeModelTeam tests ---

  describe('changeModelTeam', () => {
    test('ADMIN re-assigns the model to a new team and rewrites index keys', async () => {
      mockedGetModel.mockResolvedValue(
        buildMetadata({ modelName: 'model-x', teamId: 'team-001' })
      );
      mockedGetTeamById.mockResolvedValue({
        teamId: 'team-002',
        name: 'Team 2',
        createdBy: 'admin-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedFindByDisplayName.mockResolvedValue(null);

      const result = await changeModelTeam(adminUser, 'model-x', 'team-002');

      expect(result.oldTeamId).toBe('team-001');
      expect(result.newTeamId).toBe('team-002');
      expect(result.teamId).toBe('team-002');
      expect(mockedGetTeamById).toHaveBeenCalledWith('team-002');
      expect(mockedFindByDisplayName).toHaveBeenCalledWith('team-002', 'model x');
      expect(mockedUpdateTeamId).toHaveBeenCalledWith('model-x', 'team-002');
    });

    test('rejects a non-ADMIN caller with 403', async () => {
      await expect(
        changeModelTeam(leaderUser, 'model-x', 'team-002')
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

      expect(mockedGetModel).not.toHaveBeenCalled();
      expect(mockedUpdateTeamId).not.toHaveBeenCalled();
    });

    test('returns 404 when the model metadata does not exist', async () => {
      mockedGetModel.mockResolvedValue(null);

      await expect(
        changeModelTeam(adminUser, 'missing-model', 'team-002')
      ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

      expect(mockedGetTeamById).not.toHaveBeenCalled();
      expect(mockedUpdateTeamId).not.toHaveBeenCalled();
    });

    test('rejects when the destination team does not exist (400)', async () => {
      mockedGetModel.mockResolvedValue(
        buildMetadata({ modelName: 'model-x', teamId: 'team-001' })
      );
      mockedGetTeamById.mockResolvedValue(null);

      await expect(
        changeModelTeam(adminUser, 'model-x', 'ghost-team')
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

      expect(mockedUpdateTeamId).not.toHaveBeenCalled();
    });

    test('rejects when the destination team already has the same displayName (400)', async () => {
      mockedGetModel.mockResolvedValue(
        buildMetadata({
          modelName: 'model-x',
          teamId: 'team-001',
          displayName: 'Model X',
          displayNameLower: 'model x',
        })
      );
      mockedGetTeamById.mockResolvedValue({
        teamId: 'team-002',
        name: 'Team 2',
        createdBy: 'admin-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedFindByDisplayName.mockResolvedValue(
        buildMetadata({
          modelName: 'other-model',
          teamId: 'team-002',
          displayName: 'Model X',
          displayNameLower: 'model x',
        })
      );

      await expect(
        changeModelTeam(adminUser, 'model-x', 'team-002')
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

      expect(mockedUpdateTeamId).not.toHaveBeenCalled();
    });

    test('allows the move when the destination collision is the model itself', async () => {
      const self = buildMetadata({
        modelName: 'model-x',
        teamId: 'team-001',
        displayName: 'Model X',
        displayNameLower: 'model x',
      });
      mockedGetModel.mockResolvedValue(self);
      mockedGetTeamById.mockResolvedValue({
        teamId: 'team-002',
        name: 'Team 2',
        createdBy: 'admin-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      // Uniqueness lookup resolves to the same model (should not block).
      mockedFindByDisplayName.mockResolvedValue(self);

      const result = await changeModelTeam(adminUser, 'model-x', 'team-002');

      expect(result.newTeamId).toBe('team-002');
      expect(mockedUpdateTeamId).toHaveBeenCalledWith('model-x', 'team-002');
    });
  });

  // --- deleteModel tests ---

  describe('deleteModel', () => {
    /**
     * Transcribe send dispatcher keyed by command constructor name, so the
     * eligibility calls (DescribeLanguageModel, ListTranscriptionJobs,
     * GetTranscriptionJob) and the teardown call (DeleteLanguageModel) can be
     * stubbed independently.
     */
    function stubTranscribe(
      handlers: Partial<{
        DescribeLanguageModelCommand: (input: any) => any;
        ListTranscriptionJobsCommand: (input: any) => any;
        GetTranscriptionJobCommand: (input: any) => any;
        DeleteLanguageModelCommand: (input: any) => any;
      }>
    ): void {
      mockTranscribeSend.mockImplementation(async (command: any) => {
        const name = command?.constructor?.name as string;
        const fn = (handlers as Record<string, (input: any) => any>)[name];
        if (fn) {
          return fn(command.input);
        }
        return {};
      });
    }

    const activeModel = (): LanguageModelMetadata =>
      buildMetadata({
        modelName: 'model-x',
        teamId: 'team-001',
        s3Key: 'training-data/model-x/training.txt',
        deletionStatus: 'ACTIVE',
      });

    it('rejects a REVIEWER with 403 and performs no teardown', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      mockedGetUserTeamIds.mockResolvedValue(['team-001']);

      await expect(deleteModel(reviewerUser, 'model-x')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });

      expect(mockedSetDeletionStatus).not.toHaveBeenCalled();
      expect(mockedHardDelete).not.toHaveBeenCalled();
      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    it('returns 404 when the model is not visible to the caller', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      // Caller belongs to another team.
      mockedGetUserTeamIds.mockResolvedValue(['team-999']);

      await expect(deleteModel(leaderUser, 'model-x')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });

      expect(mockedSetDeletionStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when the model metadata does not exist', async () => {
      mockedGetModel.mockResolvedValue(null);

      await expect(deleteModel(adminUser, 'missing-model')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });
    });

    it('rejects deletion when the model is still training (DescribeLanguageModel IN_PROGRESS)', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      stubTranscribe({
        DescribeLanguageModelCommand: () => ({
          LanguageModel: { ModelName: 'model-x', ModelStatus: 'IN_PROGRESS' },
        }),
      });

      await expect(deleteModel(adminUser, 'model-x')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });

      expect(mockedSetDeletionStatus).not.toHaveBeenCalled();
      expect(mockedHardDelete).not.toHaveBeenCalled();
    });

    it('rejects deletion when an in-progress job references the model (summary carries the name)', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      stubTranscribe({
        DescribeLanguageModelCommand: () => ({
          LanguageModel: { ModelName: 'model-x', ModelStatus: 'COMPLETED' },
        }),
        ListTranscriptionJobsCommand: () => ({
          TranscriptionJobSummaries: [
            {
              TranscriptionJobName: 'job-1',
              ModelSettings: { LanguageModelName: 'model-x' },
            },
          ],
        }),
      });

      await expect(deleteModel(adminUser, 'model-x')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });

      expect(mockedSetDeletionStatus).not.toHaveBeenCalled();
    });

    it('rejects deletion when an in-progress job references the model (via GetTranscriptionJob fallback)', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      stubTranscribe({
        DescribeLanguageModelCommand: () => ({
          LanguageModel: { ModelName: 'model-x', ModelStatus: 'COMPLETED' },
        }),
        // Summary omits the model name -> fallback to GetTranscriptionJob.
        ListTranscriptionJobsCommand: () => ({
          TranscriptionJobSummaries: [{ TranscriptionJobName: 'job-1' }],
        }),
        GetTranscriptionJobCommand: () => ({
          TranscriptionJob: {
            TranscriptionJobName: 'job-1',
            ModelSettings: { LanguageModelName: 'model-x' },
          },
        }),
      });

      await expect(deleteModel(adminUser, 'model-x')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    it('paginates ListTranscriptionJobs via NextToken while checking in-use', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      let listCalls = 0;
      stubTranscribe({
        DescribeLanguageModelCommand: () => ({
          LanguageModel: { ModelName: 'model-x', ModelStatus: 'COMPLETED' },
        }),
        ListTranscriptionJobsCommand: (input: any) => {
          listCalls += 1;
          if (!input.NextToken) {
            return {
              TranscriptionJobSummaries: [
                { TranscriptionJobName: 'job-a', ModelSettings: { LanguageModelName: 'other' } },
              ],
              NextToken: 'page-2',
            };
          }
          return {
            TranscriptionJobSummaries: [
              { TranscriptionJobName: 'job-b', ModelSettings: { LanguageModelName: 'another' } },
            ],
          };
        },
      });

      await deleteModel(adminUser, 'model-x');

      expect(listCalls).toBe(2);
      expect(mockedHardDelete).toHaveBeenCalledWith('model-x');
    });

    it('deletes an ACTIVE model in order: soft-delete -> Transcribe -> S3 -> hard-delete, then audits', async () => {
      mockedGetModel.mockResolvedValue(activeModel());

      const order: string[] = [];
      mockedSetDeletionStatus.mockImplementation(async () => {
        order.push('soft-delete');
      });
      mockedHardDelete.mockImplementation(async () => {
        order.push('hard-delete');
      });
      stubTranscribe({
        DescribeLanguageModelCommand: () => ({
          LanguageModel: { ModelName: 'model-x', ModelStatus: 'COMPLETED' },
        }),
        ListTranscriptionJobsCommand: () => ({ TranscriptionJobSummaries: [] }),
        DeleteLanguageModelCommand: () => {
          order.push('transcribe-delete');
          return {};
        },
      });
      mockS3Send.mockImplementation(async () => {
        order.push('s3-delete');
        return {};
      });

      await deleteModel(adminUser, 'model-x');

      expect(order).toEqual([
        'soft-delete',
        'transcribe-delete',
        's3-delete',
        'hard-delete',
      ]);
      expect(mockedSetDeletionStatus).toHaveBeenCalledWith('model-x', 'PENDING');
      expect(mockedHardDelete).toHaveBeenCalledWith('model-x');

      // S3 delete targets the metadata s3Key.
      const s3Command = mockS3Send.mock.calls[0][0];
      expect(s3Command.input).toMatchObject({
        Bucket: 'test-data-bucket',
        Key: 'training-data/model-x/training.txt',
      });

      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'LANGUAGE_MODEL_DELETED',
          resourceId: 'model-x',
          resourceType: 'LanguageModel',
          metadata: { teamId: 'team-001', displayName: 'Model X' },
        })
      );
    });

    it('treats an already-absent Transcribe model and S3 object as success', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      stubTranscribe({
        DescribeLanguageModelCommand: () => {
          const err = Object.assign(new Error('not found'), {
            name: 'BadRequestException',
          });
          throw err;
        },
        ListTranscriptionJobsCommand: () => ({ TranscriptionJobSummaries: [] }),
        DeleteLanguageModelCommand: () => {
          const err = Object.assign(new Error('model not found'), {
            name: 'BadRequestException',
          });
          throw err;
        },
      });
      mockS3Send.mockImplementation(async () => {
        const err = Object.assign(new Error('no such key'), { name: 'NoSuchKey' });
        throw err;
      });

      await expect(deleteModel(adminUser, 'model-x')).resolves.toBeUndefined();

      expect(mockedSetDeletionStatus).toHaveBeenCalledWith('model-x', 'PENDING');
      expect(mockedHardDelete).toHaveBeenCalledWith('model-x');
      expect(mockedRecordAuditLog).toHaveBeenCalledTimes(1);
    });

    it('leaves the record PENDING and rethrows when a later step keeps failing', async () => {
      mockedGetModel.mockResolvedValue(activeModel());
      stubTranscribe({
        DescribeLanguageModelCommand: () => ({
          LanguageModel: { ModelName: 'model-x', ModelStatus: 'COMPLETED' },
        }),
        ListTranscriptionJobsCommand: () => ({ TranscriptionJobSummaries: [] }),
        DeleteLanguageModelCommand: () => {
          throw new Error('transient transcribe failure');
        },
      });

      await expect(deleteModel(adminUser, 'model-x')).rejects.toThrow(
        'transient transcribe failure'
      );

      // Soft-delete happened; hard-delete and audit did not.
      expect(mockedSetDeletionStatus).toHaveBeenCalledWith('model-x', 'PENDING');
      expect(mockedHardDelete).not.toHaveBeenCalled();
      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    it('resumes a PENDING record on re-invocation, skipping the eligibility gates', async () => {
      mockedGetModel.mockResolvedValue(
        buildMetadata({
          modelName: 'model-x',
          teamId: 'team-001',
          s3Key: 'training-data/model-x/training.txt',
          deletionStatus: 'PENDING',
        })
      );

      let describeCalled = false;
      let listCalled = false;
      stubTranscribe({
        DescribeLanguageModelCommand: () => {
          describeCalled = true;
          return { LanguageModel: { ModelStatus: 'COMPLETED' } };
        },
        ListTranscriptionJobsCommand: () => {
          listCalled = true;
          return { TranscriptionJobSummaries: [] };
        },
        DeleteLanguageModelCommand: () => ({}),
      });
      mockS3Send.mockResolvedValue({});

      await deleteModel(adminUser, 'model-x');

      // Eligibility checks are skipped for a PENDING (mid-teardown) record.
      expect(describeCalled).toBe(false);
      expect(listCalled).toBe(false);
      expect(mockedHardDelete).toHaveBeenCalledWith('model-x');
      expect(mockedRecordAuditLog).toHaveBeenCalledTimes(1);
    });
  });
});
