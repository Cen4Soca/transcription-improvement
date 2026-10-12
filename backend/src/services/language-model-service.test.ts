import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  createModel,
  listModels,
  getModelStatus,
  setTranscribeClient,
  setS3Client,
  checkRoleAccess,
  generateTrainingData,
} from './language-model-service.js';

vi.mock('./audit-service.js', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { recordAuditLog } from './audit-service.js';

const mockedRecordAuditLog = vi.mocked(recordAuditLog);

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
  });

  // --- createModel tests ---

  describe('createModel', () => {
    test('calls Transcribe CreateLanguageModel with correct parameters', async () => {
      // First call: ListLanguageModels (duplicate check) → no duplicates
      // Second call: CreateLanguageModel
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      await createModel({
        modelName: 'my-model',
        baseModelName: 'WideBand',
        segments: [{ text: 'テスト文章', confirmed: true }],
        sessionIds: ['session-001'],
        userId: 'user-001',
        userRole: 'ADMIN',
      });

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

    test('uploads training data to S3 at correct path', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      await createModel({
        modelName: 'custom-model',
        baseModelName: 'NarrowBand',
        segments: [
          { text: '確定済みテキスト1', confirmed: true },
          { text: '確定済みテキスト2', confirmed: true },
        ],
        sessionIds: ['session-001', 'session-002'],
        userId: 'user-001',
        userRole: 'TEAM_LEADER',
      });

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
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'REVIEWER',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    });

    test('rejects when model name is duplicate', async () => {
      mockTranscribeSend.mockResolvedValueOnce({
        Models: [{ ModelName: 'existing-model' }],
      });

      await expect(
        createModel({
          modelName: 'existing-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('rejects when no confirmed segments (empty training data)', async () => {
      mockTranscribeSend.mockResolvedValueOnce({ Models: [] });

      await expect(
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [
            { text: '未確定テキスト', confirmed: false },
          ],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('records AuditLog with correct parameters on success', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      await createModel({
        modelName: 'audit-test-model',
        baseModelName: 'WideBand',
        segments: [{ text: 'テスト文章', confirmed: true }],
        sessionIds: ['session-001', 'session-002'],
        userId: 'admin-001',
        userRole: 'ADMIN',
      });

      expect(mockedRecordAuditLog).toHaveBeenCalledTimes(1);
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-001',
          actorRole: 'ADMIN',
          operationType: 'LANGUAGE_MODEL_CREATED',
          resourceId: 'audit-test-model',
          resourceType: 'LanguageModel',
          metadata: {
            baseModelName: 'WideBand',
            sessionIds: 'session-001,session-002',
          },
        })
      );
    });

    test('does not record AuditLog when role check fails', async () => {
      await expect(
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'REVIEWER',
        })
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

      const result = await createModel({
        modelName: 'admin-model',
        baseModelName: 'WideBand',
        segments: [{ text: 'テスト', confirmed: true }],
        sessionIds: ['session-001'],
        userId: 'admin-001',
        userRole: 'ADMIN',
      });

      expect(result.modelName).toBe('admin-model');
      expect(result.status).toBe('IN_PROGRESS');
    });

    test('TEAM_LEADER can create a model successfully', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      const result = await createModel({
        modelName: 'leader-model',
        baseModelName: 'NarrowBand',
        segments: [{ text: 'テスト', confirmed: true }],
        sessionIds: ['session-001'],
        userId: 'leader-001',
        userRole: 'TEAM_LEADER',
      });

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
        createModel({
          modelName: 'MyModel',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    test('allows model name with different case (case-sensitive)', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [{ ModelName: 'MyModel' }] })
        .mockResolvedValueOnce({});

      const result = await createModel({
        modelName: 'mymodel',
        baseModelName: 'WideBand',
        segments: [{ text: 'テスト', confirmed: true }],
        sessionIds: ['session-001'],
        userId: 'user-001',
        userRole: 'ADMIN',
      });

      expect(result.modelName).toBe('mymodel');
    });

    test('allows model name when no existing models', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockResolvedValueOnce({});

      const result = await createModel({
        modelName: 'brand-new-model',
        baseModelName: 'WideBand',
        segments: [{ text: 'テスト', confirmed: true }],
        sessionIds: ['session-001'],
        userId: 'user-001',
        userRole: 'ADMIN',
      });

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
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toThrow('Transcribe service unavailable');
    });

    test('propagates S3 PutObject API error', async () => {
      mockTranscribeSend.mockResolvedValueOnce({ Models: [] });
      mockS3Send.mockRejectedValueOnce(
        new Error('S3 access denied')
      );

      await expect(
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toThrow('S3 access denied');
    });

    test('propagates Transcribe CreateLanguageModel API error', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockRejectedValueOnce(new Error('CreateLanguageModel failed'));
      mockS3Send.mockResolvedValueOnce({});

      await expect(
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toThrow('CreateLanguageModel failed');
    });

    test('does not record AuditLog when Transcribe API fails', async () => {
      mockTranscribeSend
        .mockResolvedValueOnce({ Models: [] })
        .mockRejectedValueOnce(new Error('Transcribe error'));
      mockS3Send.mockResolvedValueOnce({});

      await expect(
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toThrow();

      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });

    test('does not record AuditLog when S3 upload fails', async () => {
      mockTranscribeSend.mockResolvedValueOnce({ Models: [] });
      mockS3Send.mockRejectedValueOnce(new Error('S3 error'));

      await expect(
        createModel({
          modelName: 'my-model',
          baseModelName: 'WideBand',
          segments: [{ text: 'テスト', confirmed: true }],
          sessionIds: ['session-001'],
          userId: 'user-001',
          userRole: 'ADMIN',
        })
      ).rejects.toThrow();

      expect(mockedRecordAuditLog).not.toHaveBeenCalled();
    });
  });

  // --- listModels tests ---

  describe('listModels', () => {
    test('returns only COMPLETED models', async () => {
      mockTranscribeSend.mockResolvedValue({
        Models: [
          { ModelName: 'model-a', ModelStatus: 'COMPLETED', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-01') },
          { ModelName: 'model-b', ModelStatus: 'IN_PROGRESS', BaseModelName: 'NarrowBand', CreateTime: new Date('2024-01-02') },
          { ModelName: 'model-c', ModelStatus: 'COMPLETED', BaseModelName: 'WideBand', CreateTime: new Date('2024-01-03') },
          { ModelName: 'model-d', ModelStatus: 'FAILED', BaseModelName: 'NarrowBand', CreateTime: new Date('2024-01-04') },
        ],
      });

      const result = await listModels();

      expect(result).toHaveLength(2);
      expect(result[0].modelName).toBe('model-a');
      expect(result[0].modelStatus).toBe('COMPLETED');
      expect(result[1].modelName).toBe('model-c');
      expect(result[1].modelStatus).toBe('COMPLETED');
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
});
