import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  validateMaxSpeakers,
  startJob,
  getJobStatus,
  getJobStatusFromTranscribe,
  setTranscribeClient,
} from './transcription-job-service.js';

// Mock dependencies
vi.mock('../repositories/transcription-job-repository.js', () => ({
  save: vi.fn().mockResolvedValue(undefined),
  getById: vi.fn(),
  updateStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repositories/media-file-repository.js', () => ({
  getById: vi.fn(),
  updateSessionId: vi.fn().mockResolvedValue(undefined),
  updateStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./session-service.js', () => ({
  createSessionForJob: vi.fn().mockResolvedValue({
    sessionId: 'session-uuid',
    transcriptionJobId: 'test-uuid-1234',
    name: 'tr-test-uuid-1234',
    status: 'PENDING',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
}));

vi.mock('./access-control-service.js', () => ({
  checkLanguageModelAccess: vi.fn(),
  getUserTeamIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('./audit-service.js', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import { checkLanguageModelAccess, getUserTeamIds } from './access-control-service.js';
import { recordAuditLog } from './audit-service.js';
import type { AuthUser } from '../utils/auth-middleware.js';
import type { LanguageModelMetadata } from '../types/index.js';
import { AppError } from '../utils/error-handler.js';

const mockedCheckLanguageModelAccess = vi.mocked(checkLanguageModelAccess);
const mockedGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

const reviewerUser: AuthUser = {
  userId: 'user-1',
  email: 'reviewer@example.com',
  displayName: 'Reviewer',
  role: 'REVIEWER',
};

const adminUser: AuthUser = {
  userId: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'ADMIN',
};

function buildModelMetadata(
  overrides: Partial<LanguageModelMetadata> = {}
): LanguageModelMetadata {
  return {
    modelName: 'my-custom-model',
    teamId: 'team-A',
    displayName: 'My Model',
    displayNameLower: 'my model',
    baseModelName: 'WideBand',
    createdBy: 'leader-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    sessionIds: [],
    s3Key: 'training-data/my-custom-model/training.txt',
    deletionStatus: 'ACTIVE',
    ...overrides,
  };
}

// --- validateMaxSpeakers tests ---

describe('validateMaxSpeakers', () => {
  test('accepts value 2 (minimum)', () => {
    expect(validateMaxSpeakers(2)).toEqual({ valid: true });
  });

  test('accepts value 10 (maximum)', () => {
    expect(validateMaxSpeakers(10)).toEqual({ valid: true });
  });

  test('accepts value 5 (mid-range)', () => {
    expect(validateMaxSpeakers(5)).toEqual({ valid: true });
  });

  test('rejects value 1 (below minimum)', () => {
    const result = validateMaxSpeakers(1);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('2〜10');
  });

  test('rejects value 11 (above maximum)', () => {
    const result = validateMaxSpeakers(11);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('2〜10');
  });

  test('rejects value 0', () => {
    const result = validateMaxSpeakers(0);
    expect(result.valid).toBe(false);
  });

  test('rejects negative values', () => {
    const result = validateMaxSpeakers(-1);
    expect(result.valid).toBe(false);
  });

  test('rejects non-integer values', () => {
    const result = validateMaxSpeakers(2.5);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('整数');
  });
});

// --- startJob tests ---

describe('startJob', () => {
  const mockSend = vi.fn().mockResolvedValue({});

  beforeEach(() => {
    vi.clearAllMocks();
    // Set environment variables
    vi.stubEnv('MEDIA_BUCKET_NAME', 'test-media-bucket');
    vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');

    // Set mock Transcribe client
    setTranscribeClient({ send: mockSend } as any);

    // Default access-control / audit behavior
    mockedCheckLanguageModelAccess.mockResolvedValue(buildModelMetadata());
    mockedGetUserTeamIds.mockResolvedValue([]);
    mockedRecordAuditLog.mockResolvedValue(undefined);

    // Default mock for mediaFileRepository.getById
    vi.mocked(mediaFileRepository.getById).mockResolvedValue({
      mediaFileId: 'media-123',
      filename: 'test-audio.mp3',
      s3Key: 'media/media-123/test-audio.mp3',
      contentType: 'audio/mpeg',
      fileSize: 1024,
      uploadedBy: 'user-1',
      status: 'UPLOADED',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  test('starts a job with default parameters', async () => {
    const result = await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    expect(result.jobId).toBe('test-uuid-1234');
    expect(result.transcribeJobName).toBe('tr-test-uuid-1234');
    expect(result.mediaFileId).toBe('media-123');
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.languageCode).toBe('ja-JP');
    expect(result.maxSpeakerLabels).toBe(2);
    expect(result.startedBy).toBe('user-1');
    expect(result.outputS3Key).toBe('transcriptions/test-uuid-1234/output.json');
  });

  test('calls Transcribe with correct parameters', async () => {
    await startJob({
      mediaFileId: 'media-123',
      maxSpeakerLabels: 5,
      languageCode: 'en-US',
      user: reviewerUser,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      TranscriptionJobName: 'tr-test-uuid-1234',
      Media: {
        MediaFileUri: 's3://test-media-bucket/media/media-123/test-audio.mp3',
      },
      OutputBucketName: 'test-data-bucket',
      OutputKey: 'transcriptions/test-uuid-1234/output.json',
      LanguageCode: 'en-US',
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 5,
      },
    });
  });

  test('includes ModelSettings when languageModelName is provided', async () => {
    await startJob({
      mediaFileId: 'media-123',
      languageModelName: 'my-custom-model',
      user: reviewerUser,
    });

    const command = mockSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      ModelSettings: {
        LanguageModelName: 'my-custom-model',
      },
    });
  });

  test('does not include ModelSettings when languageModelName is not provided', async () => {
    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    const command = mockSend.mock.calls[0][0];
    expect(command.input.ModelSettings).toBeUndefined();
  });

  test('saves job record to repository', async () => {
    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    expect(transcriptionJobRepository.save).toHaveBeenCalledTimes(1);
    const savedRecord = vi.mocked(transcriptionJobRepository.save).mock.calls[0][0];
    expect(savedRecord.jobId).toBe('test-uuid-1234');
    expect(savedRecord.status).toBe('IN_PROGRESS');
  });

  test('re-links the media file to the newly created session', async () => {
    const result = await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    // The media file must be re-linked to the created session so that
    // re-transcription rebuilds a usable session <-> media relationship.
    expect(mediaFileRepository.updateSessionId).toHaveBeenCalledWith(
      'media-123',
      'session-uuid'
    );
    // The returned job record reflects the linked session.
    expect(result.sessionId).toBe('session-uuid');
  });

  test('advances the media file status to PROCESSING when the job starts', async () => {
    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    // The media list should reflect that transcription is in progress instead
    // of staying at "アップロード完了" (UPLOADED).
    expect(mediaFileRepository.updateStatus).toHaveBeenCalledWith(
      'media-123',
      'PROCESSING'
    );
  });

  test('still creates the job when advancing the media status fails', async () => {
    vi.mocked(mediaFileRepository.updateStatus).mockRejectedValueOnce(
      new Error('update failed')
    );

    const result = await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    expect(result.jobId).toBe('test-uuid-1234');
    expect(result.status).toBe('IN_PROGRESS');
  });

  test('persists the job record with the linked sessionId', async () => {
    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    const savedRecord = vi.mocked(transcriptionJobRepository.save).mock.calls[0][0];
    expect(savedRecord.sessionId).toBe('session-uuid');
  });

  test('still creates the job when re-linking the media file fails', async () => {
    vi.mocked(mediaFileRepository.updateSessionId).mockRejectedValueOnce(
      new Error('update failed')
    );

    const result = await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    // Job creation must not be blocked by a re-link failure.
    expect(result.jobId).toBe('test-uuid-1234');
    expect(result.status).toBe('IN_PROGRESS');
    expect(transcriptionJobRepository.save).toHaveBeenCalledTimes(1);
  });

  test('throws validation error for invalid maxSpeakerLabels', async () => {
    await expect(
      startJob({
        mediaFileId: 'media-123',
        maxSpeakerLabels: 15,
        user: reviewerUser,
      })
    ).rejects.toThrow('MaxSpeakerLabels は 2〜10 の範囲で指定してください。');
  });

  test('throws not found error when media file does not exist', async () => {
    vi.mocked(mediaFileRepository.getById).mockResolvedValue(null);

    await expect(
      startJob({
        mediaFileId: 'nonexistent',
        user: reviewerUser,
      })
    ).rejects.toThrow('指定されたメディアファイルが見つかりません。');
  });

  test('throws configuration error when MEDIA_BUCKET_NAME is not set', async () => {
    vi.stubEnv('MEDIA_BUCKET_NAME', '');

    await expect(
      startJob({
        mediaFileId: 'media-123',
        user: reviewerUser,
      })
    ).rejects.toThrow('バケットの設定が不足しています。');
  });

  test('throws configuration error when DATA_BUCKET_NAME is not set', async () => {
    vi.stubEnv('DATA_BUCKET_NAME', '');

    await expect(
      startJob({
        mediaFileId: 'media-123',
        user: reviewerUser,
      })
    ).rejects.toThrow('バケットの設定が不足しています。');
  });

  test('starts a job with maxSpeakerLabels at minimum boundary (2)', async () => {
    const result = await startJob({
      mediaFileId: 'media-123',
      maxSpeakerLabels: 2,
      user: reviewerUser,
    });

    expect(result.maxSpeakerLabels).toBe(2);
    const command = mockSend.mock.calls[0][0];
    expect(command.input.Settings.MaxSpeakerLabels).toBe(2);
  });

  test('starts a job with maxSpeakerLabels at maximum boundary (10)', async () => {
    const result = await startJob({
      mediaFileId: 'media-123',
      maxSpeakerLabels: 10,
      user: reviewerUser,
    });

    expect(result.maxSpeakerLabels).toBe(10);
    const command = mockSend.mock.calls[0][0];
    expect(command.input.Settings.MaxSpeakerLabels).toBe(10);
  });

  test('does not throw when createSessionForJob fails', async () => {
    const { createSessionForJob } = await import('./session-service.js');
    vi.mocked(createSessionForJob).mockRejectedValueOnce(new Error('Session creation failed'));

    const result = await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    // Job should still be created successfully
    expect(result.jobId).toBe('test-uuid-1234');
    expect(result.status).toBe('IN_PROGRESS');
  });

  test('sets ShowSpeakerLabels to true in Transcribe settings (Req 17.2)', async () => {
    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    const command = mockSend.mock.calls[0][0];
    expect(command.input.Settings.ShowSpeakerLabels).toBe(true);
  });

  test('auto-assigns the created session to the uploader (mediaFile.uploadedBy)', async () => {
    const { createSessionForJob } = await import('./session-service.js');

    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    // 4th argument is the assigned userId, taken from mediaFile.uploadedBy
    expect(createSessionForJob).toHaveBeenCalledWith(
      'test-uuid-1234',
      'tr-test-uuid-1234',
      undefined,
      'user-1'
    );
  });

  // --- Language model team isolation on job start ---

  test('enforces language model access when languageModelName is provided', async () => {
    await startJob({
      mediaFileId: 'media-123',
      languageModelName: 'my-custom-model',
      user: reviewerUser,
    });

    expect(mockedCheckLanguageModelAccess).toHaveBeenCalledWith(
      reviewerUser,
      'my-custom-model'
    );
  });

  test('does not check language model access when no model is provided', async () => {
    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    expect(mockedCheckLanguageModelAccess).not.toHaveBeenCalled();
  });

  test('rejects with 404 when the language model is not accessible to the caller', async () => {
    mockedCheckLanguageModelAccess.mockRejectedValueOnce(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    await expect(
      startJob({
        mediaFileId: 'media-123',
        languageModelName: 'other-team-model',
        user: reviewerUser,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    // The job must not be started or persisted when access is denied.
    expect(mockSend).not.toHaveBeenCalled();
    expect(transcriptionJobRepository.save).not.toHaveBeenCalled();
  });

  test('records a job-start audit log with languageModelName', async () => {
    await startJob({
      mediaFileId: 'media-123',
      languageModelName: 'my-custom-model',
      user: reviewerUser,
    });

    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        actorRole: 'REVIEWER',
        operationType: 'TRANSCRIPTION_JOB_STARTED',
        resourceId: 'test-uuid-1234',
        resourceType: 'TranscriptionJob',
        metadata: expect.objectContaining({
          languageModelName: 'my-custom-model',
        }),
      })
    );
    // A same-team caller is not flagged as cross-team.
    const metadata = mockedRecordAuditLog.mock.calls[0][0].metadata as Record<string, unknown>;
    expect(metadata['crossTeamModelUsage']).toBeUndefined();
  });

  test('records a job-start audit log without languageModelName when no model is used', async () => {
    await startJob({
      mediaFileId: 'media-123',
      user: reviewerUser,
    });

    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'TRANSCRIPTION_JOB_STARTED',
        resourceId: 'test-uuid-1234',
      })
    );
    const metadata = mockedRecordAuditLog.mock.calls[0][0].metadata as Record<string, unknown>;
    expect(metadata['languageModelName']).toBeUndefined();
    expect(metadata['crossTeamModelUsage']).toBeUndefined();
  });

  test('flags crossTeamModelUsage when ADMIN uses a model from a team they do not belong to', async () => {
    // Model belongs to team-A; admin belongs to no team (or other teams).
    mockedCheckLanguageModelAccess.mockResolvedValue(
      buildModelMetadata({ teamId: 'team-A' })
    );
    mockedGetUserTeamIds.mockResolvedValue(['team-Z']);

    await startJob({
      mediaFileId: 'media-123',
      languageModelName: 'my-custom-model',
      user: adminUser,
    });

    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        actorRole: 'ADMIN',
        operationType: 'TRANSCRIPTION_JOB_STARTED',
        metadata: expect.objectContaining({
          languageModelName: 'my-custom-model',
          crossTeamModelUsage: true,
        }),
      })
    );
  });

  test('does not flag crossTeamModelUsage when ADMIN uses a model from their own team', async () => {
    mockedCheckLanguageModelAccess.mockResolvedValue(
      buildModelMetadata({ teamId: 'team-A' })
    );
    mockedGetUserTeamIds.mockResolvedValue(['team-A']);

    await startJob({
      mediaFileId: 'media-123',
      languageModelName: 'my-custom-model',
      user: adminUser,
    });

    const metadata = mockedRecordAuditLog.mock.calls[0][0].metadata as Record<string, unknown>;
    expect(metadata['crossTeamModelUsage']).toBeUndefined();
  });
});

// --- getJobStatus tests ---

describe('getJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns job record when found', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'IN_PROGRESS' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);

    const result = await getJobStatus('job-123');
    expect(result).toEqual(mockJob);
  });

  test('throws not found error when job does not exist', async () => {
    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(null);

    await expect(getJobStatus('nonexistent')).rejects.toThrow(
      '指定された Transcription ジョブが見つかりません。'
    );
  });
});

// --- getJobStatusFromTranscribe tests ---

describe('getJobStatusFromTranscribe', () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setTranscribeClient({ send: mockSend } as any);
  });

  test('returns cached job when status is already COMPLETED', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'COMPLETED' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);

    const result = await getJobStatusFromTranscribe('job-123');
    expect(result).toEqual(mockJob);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns cached job when status is already FAILED', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'FAILED' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      failureReason: 'Some error',
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);

    const result = await getJobStatusFromTranscribe('job-123');
    expect(result).toEqual(mockJob);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('calls Transcribe API when status is IN_PROGRESS', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'IN_PROGRESS' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);
    mockSend.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    const result = await getJobStatusFromTranscribe('job-123');
    expect(result).toEqual(mockJob);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('updates DynamoDB when Transcribe reports COMPLETED', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'IN_PROGRESS' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);
    mockSend.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'COMPLETED',
      },
    });

    const result = await getJobStatusFromTranscribe('job-123');
    expect(result.status).toBe('COMPLETED');
    expect(transcriptionJobRepository.updateStatus).toHaveBeenCalledWith(
      'job-123',
      'COMPLETED',
      undefined
    );
  });

  test('updates DynamoDB with failure reason when Transcribe reports FAILED', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'IN_PROGRESS' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);
    mockSend.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'FAILED',
        FailureReason: 'Audio file is corrupted',
      },
    });

    const result = await getJobStatusFromTranscribe('job-123');
    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('Audio file is corrupted');
    expect(transcriptionJobRepository.updateStatus).toHaveBeenCalledWith(
      'job-123',
      'FAILED',
      'Audio file is corrupted'
    );
    // The media file is mirrored to FAILED so the media list shows "失敗".
    expect(mediaFileRepository.updateStatus).toHaveBeenCalledWith(
      'media-123',
      'FAILED'
    );
  });

  test('throws not found error when job does not exist', async () => {
    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(null);

    await expect(getJobStatusFromTranscribe('nonexistent')).rejects.toThrow(
      '指定された Transcription ジョブが見つかりません。'
    );
  });

  test('returns cached job when Transcribe returns no TranscriptionJob', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'IN_PROGRESS' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);
    mockSend.mockResolvedValue({
      TranscriptionJob: undefined,
    });

    const result = await getJobStatusFromTranscribe('job-123');
    expect(result).toEqual(mockJob);
    expect(transcriptionJobRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('uses default failure reason when Transcribe FAILED without FailureReason', async () => {
    const mockJob = {
      jobId: 'job-123',
      transcribeJobName: 'tr-abc',
      mediaFileId: 'media-123',
      status: 'IN_PROGRESS' as const,
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      startedBy: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    vi.mocked(transcriptionJobRepository.getById).mockResolvedValue(mockJob);
    mockSend.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'FAILED',
        FailureReason: undefined,
      },
    });

    const result = await getJobStatusFromTranscribe('job-123');
    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('Unknown error');
    expect(transcriptionJobRepository.updateStatus).toHaveBeenCalledWith(
      'job-123',
      'FAILED',
      'Unknown error'
    );
  });
});
