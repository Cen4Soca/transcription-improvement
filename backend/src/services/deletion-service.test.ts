import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  deleteMediaFile,
  deleteTranscription,
  setS3Client,
} from './deletion-service.js';

// --- Mocks ---

vi.mock('../repositories/media-file-repository.js', () => ({
  getById: vi.fn(),
  deleteById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
  updateSessionStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repositories/transcription-job-repository.js', () => ({
  updateStatus: vi.fn().mockResolvedValue(undefined),
  listByMediaFileId: vi.fn().mockResolvedValue([]),
  deleteById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./audit-service.js', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./access-control-service.js', () => ({
  canAccessMediaFile: vi.fn(),
}));

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: vi.fn().mockResolvedValue({ Items: [] }) },
  TABLE_NAME: 'TestTable',
}));

import * as mediaFileRepository from '../repositories/media-file-repository.js';
import * as sessionRepository from '../repositories/session-repository.js';
import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import { recordAuditLog } from './audit-service.js';
import { canAccessMediaFile } from './access-control-service.js';
import { docClient } from '../utils/dynamodb-client.js';
import type { AuthUser } from '../utils/auth-middleware.js';

const mockedGetById = vi.mocked(mediaFileRepository.getById);
const mockedCanAccessMediaFile = vi.mocked(canAccessMediaFile);

// --- Test user fixtures ---
const adminUser: AuthUser = {
  userId: 'admin-001',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'ADMIN',
};
const teamLeaderUser: AuthUser = {
  userId: 'leader-001',
  email: 'leader@example.com',
  displayName: 'Leader',
  role: 'TEAM_LEADER',
};
const reviewerUser: AuthUser = {
  userId: 'reviewer-001',
  email: 'reviewer@example.com',
  displayName: 'Reviewer',
  role: 'REVIEWER',
};
const mockedDeleteById = vi.mocked(mediaFileRepository.deleteById);
const mockedGetSessionById = vi.mocked(sessionRepository.getSessionById);
const mockedUpdateSessionStatus = vi.mocked(sessionRepository.updateSessionStatus);
const mockedUpdateJobStatus = vi.mocked(transcriptionJobRepository.updateStatus);
const mockedListJobsByMedia = vi.mocked(transcriptionJobRepository.listByMediaFileId);
const mockedDeleteJobById = vi.mocked(transcriptionJobRepository.deleteById);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);
const mockedDocClientSend = vi.mocked(docClient.send);

// Mock S3 client
const mockS3Send = vi.fn().mockResolvedValue({});
const mockS3Client = { send: mockS3Send } as unknown as S3Client;

describe('DeletionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setS3Client(mockS3Client);
    process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
    process.env.DATA_BUCKET_NAME = 'test-data-bucket';
    // Default: access granted. Individual tests override as needed.
    mockedCanAccessMediaFile.mockResolvedValue(true);
    // Default: no linked session (skip IN_PROGRESS guard). Tests override as needed.
    mockedGetSessionById.mockResolvedValue(null);
  });

  describe('deleteMediaFile', () => {
    const validMediaFile = {
      mediaFileId: 'media-001',
      filename: 'test-audio.mp3',
      s3Key: 'media/media-001/test-audio.mp3',
      contentType: 'audio/mpeg',
      fileSize: 1024000,
      uploadedBy: 'user-002',
      teamId: 'team-001',
      status: 'UPLOADED' as const,
      sessionId: 'session-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    it('successfully deletes a media file for Admin', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedDocClientSend.mockResolvedValue({} as any);

      await deleteMediaFile({
        mediaFileId: 'media-001',
        user: adminUser,
      });

      // S3 delete called
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'test-media-bucket',
            Key: 'media/media-001/test-audio.mp3',
          },
        })
      );

      // DynamoDB metadata deleted
      expect(mockedDeleteById).toHaveBeenCalledWith('media-001');

      // AuditLog recorded
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-001',
          actorRole: 'ADMIN',
          operationType: 'MEDIA_DELETED',
          resourceId: 'media-001',
          resourceType: 'MediaFile',
        })
      );
    });

    it('successfully deletes a media file for TeamLeader of a team member', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedCanAccessMediaFile.mockResolvedValue(true);
      mockedDocClientSend.mockResolvedValue({} as any);

      await deleteMediaFile({
        mediaFileId: 'media-001',
        user: teamLeaderUser,
      });

      expect(mockS3Send).toHaveBeenCalled();
      expect(mockedDeleteById).toHaveBeenCalledWith('media-001');
      expect(mockedRecordAuditLog).toHaveBeenCalled();
    });

    it('successfully deletes own media file for REVIEWER', async () => {
      mockedGetById.mockResolvedValue({ ...validMediaFile, uploadedBy: 'reviewer-001' });
      mockedCanAccessMediaFile.mockResolvedValue(true);
      mockedDocClientSend.mockResolvedValue({} as any);

      await deleteMediaFile({
        mediaFileId: 'media-001',
        user: reviewerUser,
      });

      expect(mockS3Send).toHaveBeenCalled();
      expect(mockedDeleteById).toHaveBeenCalledWith('media-001');
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'reviewer-001',
          actorRole: 'REVIEWER',
          operationType: 'MEDIA_DELETED',
        })
      );
    });

    it('throws 404 when REVIEWER tries to delete a file uploaded by someone else', async () => {
      mockedGetById.mockResolvedValue(validMediaFile); // uploadedBy: user-002
      mockedCanAccessMediaFile.mockResolvedValue(false);

      await expect(
        deleteMediaFile({
          mediaFileId: 'media-001',
          user: reviewerUser,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });

      // Should not proceed to S3 delete
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('throws 404 when media file not found', async () => {
      mockedGetById.mockResolvedValue(null);

      await expect(
        deleteMediaFile({
          mediaFileId: 'nonexistent',
          user: adminUser,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });

    it('throws 409 CONFIRMATION_REQUIRED when ADMIN deletes media of an IN_PROGRESS session without force', async () => {
      mockedGetById.mockResolvedValue(validMediaFile); // sessionId: session-001
      mockedCanAccessMediaFile.mockResolvedValue(true);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-001',
        name: 'in-progress session',
        status: 'IN_PROGRESS',
        assignedReviewerCount: 1,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(
        deleteMediaFile({ mediaFileId: 'media-001', user: adminUser })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFIRMATION_REQUIRED',
      });

      // Should not delete when confirmation is required
      expect(mockS3Send).not.toHaveBeenCalled();
      expect(mockedDeleteById).not.toHaveBeenCalled();
    });

    it('deletes media of an IN_PROGRESS session when ADMIN passes force=true', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedCanAccessMediaFile.mockResolvedValue(true);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-001',
        name: 'in-progress session',
        status: 'IN_PROGRESS',
        assignedReviewerCount: 1,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedDocClientSend.mockResolvedValue({} as any);

      await deleteMediaFile({ mediaFileId: 'media-001', user: adminUser, force: true });

      expect(mockS3Send).toHaveBeenCalled();
      expect(mockedDeleteById).toHaveBeenCalledWith('media-001');
    });

    it('throws 403 when REVIEWER deletes media of an IN_PROGRESS session (even own upload)', async () => {
      mockedGetById.mockResolvedValue({ ...validMediaFile, uploadedBy: 'reviewer-001' });
      mockedCanAccessMediaFile.mockResolvedValue(true);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-001',
        name: 'in-progress session',
        status: 'IN_PROGRESS',
        assignedReviewerCount: 1,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(
        deleteMediaFile({ mediaFileId: 'media-001', user: reviewerUser })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });

      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('throws 404 when TeamLeader tries to delete media uploaded by a non-member', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedCanAccessMediaFile.mockResolvedValue(false);

      await expect(
        deleteMediaFile({
          mediaFileId: 'media-001',
          user: teamLeaderUser,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });

      // Should not proceed to S3 delete
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('deletes a PENDING linked session when media file is deleted (Req 6)', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-001',
        name: 'pending session',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      // Query returns the session records to cascade delete.
      mockedDocClientSend.mockImplementation((command: any) => {
        if (command.input?.KeyConditionExpression) {
          return Promise.resolve({
            Items: [
              { PK: 'SESSION#session-001', SK: 'METADATA' },
              { PK: 'SESSION#session-001', SK: 'SEGMENT#seg-001' },
            ],
          });
        }
        return Promise.resolve({});
      });

      await deleteMediaFile({ mediaFileId: 'media-001', user: adminUser });

      // Cascade delete BatchWrite includes the session METADATA (session removed)
      const batchWriteCalls = mockedDocClientSend.mock.calls.filter(
        (call) => call[0]?.input?.RequestItems
      );
      const deletedKeys = batchWriteCalls.flatMap((call) =>
        (call[0].input.RequestItems.TestTable as Array<{ DeleteRequest: { Key: { SK: string } } }>).map(
          (req) => req.DeleteRequest.Key.SK
        )
      );
      expect(deletedKeys).toContain('METADATA');
      // Not moved to COMPLETED
      expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
    });

    it('completes an IN_PROGRESS linked session when media file is deleted with force (Req 6)', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-001',
        name: 'in-progress session',
        status: 'IN_PROGRESS',
        assignedReviewerCount: 1,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedDocClientSend.mockResolvedValue({} as any);

      await deleteMediaFile({ mediaFileId: 'media-001', user: adminUser, force: true });

      // Session is moved to COMPLETED (review work preserved)
      expect(mockedUpdateSessionStatus).toHaveBeenCalledWith('session-001', 'COMPLETED');
    });

    it('records AuditLog with correct metadata', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedDocClientSend.mockResolvedValue({} as any);

      await deleteMediaFile({
        mediaFileId: 'media-001',
        user: adminUser,
      });

      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            filename: 'test-audio.mp3',
            s3Key: 'media/media-001/test-audio.mp3',
          },
        })
      );
    });

    it('cascade deletes all transcription jobs and their S3 output for the media file', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedDocClientSend.mockResolvedValue({} as any);
      // Two jobs exist for this media file (e.g. a current job + a superseded orphan).
      mockedListJobsByMedia.mockResolvedValue([
        {
          jobId: 'job-current',
          transcribeJobName: 'tr-current',
          mediaFileId: 'media-001',
          status: 'IN_PROGRESS',
          languageCode: 'ja-JP',
          maxSpeakerLabels: 2,
          outputS3Key: 'transcriptions/job-current/output.json',
          startedBy: 'user-002',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        {
          jobId: 'job-orphan',
          transcribeJobName: 'tr-orphan',
          mediaFileId: 'media-001',
          status: 'IN_PROGRESS',
          languageCode: 'ja-JP',
          maxSpeakerLabels: 2,
          // No outputS3Key -> falls back to the conventional key path.
          startedBy: 'user-002',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]);

      await deleteMediaFile({ mediaFileId: 'media-001', user: adminUser });

      // Both job records are deleted.
      expect(mockedDeleteJobById).toHaveBeenCalledWith('job-current');
      expect(mockedDeleteJobById).toHaveBeenCalledWith('job-orphan');

      // S3 output for each job is deleted (explicit key + fallback key).
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'test-data-bucket',
            Key: 'transcriptions/job-current/output.json',
          },
        })
      );
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'test-data-bucket',
            Key: 'transcriptions/job-orphan/output.json',
          },
        })
      );
    });

    it('continues deleting other jobs when one job S3 delete fails mid-cascade (regression)', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedDocClientSend.mockResolvedValue({} as any);
      mockedListJobsByMedia.mockResolvedValue([
        {
          jobId: 'job-fail',
          transcribeJobName: 'tr-fail',
          mediaFileId: 'media-001',
          status: 'IN_PROGRESS',
          languageCode: 'ja-JP',
          maxSpeakerLabels: 2,
          outputS3Key: 'transcriptions/job-fail/output.json',
          startedBy: 'user-002',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        {
          jobId: 'job-ok',
          transcribeJobName: 'tr-ok',
          mediaFileId: 'media-001',
          status: 'IN_PROGRESS',
          languageCode: 'ja-JP',
          maxSpeakerLabels: 2,
          outputS3Key: 'transcriptions/job-ok/output.json',
          startedBy: 'user-002',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]);

      // Fail ONLY the first job's S3 output delete; resolve everything else.
      mockS3Send.mockImplementation((command: any) => {
        if (command.input?.Key === 'transcriptions/job-fail/output.json') {
          return Promise.reject(new Error('S3 throttled'));
        }
        return Promise.resolve({});
      });

      await expect(
        deleteMediaFile({ mediaFileId: 'media-001', user: adminUser })
      ).rejects.toThrow();

      // (a) BOTH jobs' S3 deletes were attempted (the failing job + the surviving job).
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { Bucket: 'test-data-bucket', Key: 'transcriptions/job-fail/output.json' },
        })
      );
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { Bucket: 'test-data-bucket', Key: 'transcriptions/job-ok/output.json' },
        })
      );

      // (b) The surviving job's record is still deleted (cascade did NOT abort).
      expect(mockedDeleteJobById).toHaveBeenCalledWith('job-ok');
      // The failing job's record delete is skipped (S3 delete came first and threw).
      expect(mockedDeleteJobById).not.toHaveBeenCalledWith('job-fail');

      // (c + d) PARTIAL_DELETION_FAILURE recorded with the preserved reason format.
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'PARTIAL_DELETION_FAILURE',
          resourceType: 'MediaFile',
          resourceId: 'media-001',
          metadata: expect.objectContaining({
            reason: expect.stringContaining('S3=deleted'),
          }),
        })
      );
      const partialCall = mockedRecordAuditLog.mock.calls.find(
        (call) => call[0].operationType === 'PARTIAL_DELETION_FAILURE'
      );
      const reason = (partialCall![0].metadata as Record<string, string>).reason;
      expect(reason).toContain('Partial deletion failure');
      expect(reason).toContain('metadata=deleted');

      // Restore default so later tests are unaffected.
      mockS3Send.mockResolvedValue({});
    });

    it('continues deleting other jobs when one job DynamoDB record delete fails mid-cascade (regression)', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      mockedDocClientSend.mockResolvedValue({} as any);
      mockS3Send.mockResolvedValue({});
      mockedListJobsByMedia.mockResolvedValue([
        {
          jobId: 'job-fail',
          transcribeJobName: 'tr-fail',
          mediaFileId: 'media-001',
          status: 'IN_PROGRESS',
          languageCode: 'ja-JP',
          maxSpeakerLabels: 2,
          outputS3Key: 'transcriptions/job-fail/output.json',
          startedBy: 'user-002',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        {
          jobId: 'job-ok',
          transcribeJobName: 'tr-ok',
          mediaFileId: 'media-001',
          status: 'IN_PROGRESS',
          languageCode: 'ja-JP',
          maxSpeakerLabels: 2,
          outputS3Key: 'transcriptions/job-ok/output.json',
          startedBy: 'user-002',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]);

      // Fail ONLY the first job's DynamoDB record delete; resolve the other.
      mockedDeleteJobById.mockImplementation((jobId: string) => {
        if (jobId === 'job-fail') {
          return Promise.reject(new Error('DynamoDB delete failed'));
        }
        return Promise.resolve(undefined);
      });

      await expect(
        deleteMediaFile({ mediaFileId: 'media-001', user: adminUser })
      ).rejects.toThrow();

      // Both jobs' S3 outputs were deleted.
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { Bucket: 'test-data-bucket', Key: 'transcriptions/job-fail/output.json' },
        })
      );
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { Bucket: 'test-data-bucket', Key: 'transcriptions/job-ok/output.json' },
        })
      );

      // The surviving job's record is still deleted (cascade did NOT abort).
      expect(mockedDeleteJobById).toHaveBeenCalledWith('job-ok');

      // PARTIAL_DELETION_FAILURE still recorded and the error re-thrown.
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'PARTIAL_DELETION_FAILURE',
          resourceType: 'MediaFile',
          resourceId: 'media-001',
        })
      );
    });
  });

  describe('deleteTranscription', () => {
    const validSession = {
      sessionId: 'session-001',
      name: '会議録_20240101',
      status: 'COMPLETED' as const,
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-15T10:30:00.000Z',
    };

    beforeEach(() => {
      mockedGetSessionById.mockResolvedValue(validSession);

      // Mock getSessionTeamId (GetCommand for GSI1PK)
      mockedDocClientSend.mockImplementation((command: any) => {
        if (command.input?.ProjectionExpression === 'GSI1PK') {
          return Promise.resolve({
            Item: { GSI1PK: 'TEAM#team-001' },
          });
        }
        if (command.input?.ProjectionExpression === 'transcriptionJobId') {
          return Promise.resolve({
            Item: { transcriptionJobId: 'job-001' },
          });
        }
        if (command.input?.KeyConditionExpression) {
          // QueryCommand for cascade delete
          return Promise.resolve({
            Items: [
              { PK: 'SESSION#session-001', SK: 'METADATA' },
              { PK: 'SESSION#session-001', SK: 'SEGMENT#seg-001' },
              { PK: 'SESSION#session-001', SK: 'CORRECTION#corr-001' },
              { PK: 'SESSION#session-001', SK: 'CONSENSUS#cons-001' },
            ],
          });
        }
        // BatchWriteCommand
        return Promise.resolve({});
      });
    });

    it('successfully deletes transcription for Admin', async () => {
      await deleteTranscription({
        sessionId: 'session-001',
        userId: 'admin-001',
        userRole: 'ADMIN',
        userTeamId: 'team-999',
      });

      // S3 transcription output deleted
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'test-data-bucket',
            Key: 'transcriptions/job-001/output.json',
          },
        })
      );

      // AuditLog recorded
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-001',
          actorRole: 'ADMIN',
          operationType: 'TRANSCRIPTION_DELETED',
          resourceId: 'session-001',
          resourceType: 'ReviewSession',
          metadata: { sessionName: '会議録_20240101', jobReset: true },
        })
      );
    });

    it('successfully deletes transcription for TeamLeader of same team', async () => {
      await deleteTranscription({
        sessionId: 'session-001',
        userId: 'leader-001',
        userRole: 'TEAM_LEADER',
        userTeamId: 'team-001',
      });

      expect(mockS3Send).toHaveBeenCalled();
      expect(mockedRecordAuditLog).toHaveBeenCalled();
    });

    it('throws 403 when user role is REVIEWER', async () => {
      await expect(
        deleteTranscription({
          sessionId: 'session-001',
          userId: 'reviewer-001',
          userRole: 'REVIEWER',
          userTeamId: 'team-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });

      expect(mockedGetSessionById).not.toHaveBeenCalled();
    });

    it('throws 404 when session not found', async () => {
      mockedGetSessionById.mockResolvedValue(null);

      await expect(
        deleteTranscription({
          sessionId: 'nonexistent',
          userId: 'admin-001',
          userRole: 'ADMIN',
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });

    it('throws 404 when TeamLeader tries to delete transcription from another team', async () => {
      await expect(
        deleteTranscription({
          sessionId: 'session-001',
          userId: 'leader-002',
          userRole: 'TEAM_LEADER',
          userTeamId: 'team-999', // different team
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });

      // Should not proceed to S3 delete
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('performs cascade delete of all related DynamoDB records', async () => {
      await deleteTranscription({
        sessionId: 'session-001',
        userId: 'admin-001',
        userRole: 'ADMIN',
      });

      // Verify QueryCommand was called to find all related items
      const queryCalls = mockedDocClientSend.mock.calls.filter(
        (call) => call[0]?.input?.KeyConditionExpression
      );
      expect(queryCalls.length).toBeGreaterThan(0);

      // Verify BatchWriteCommand was called to delete items
      const batchWriteCalls = mockedDocClientSend.mock.calls.filter(
        (call) => call[0]?.input?.RequestItems
      );
      expect(batchWriteCalls.length).toBeGreaterThan(0);
    });

    it('records AuditLog with session name', async () => {
      await deleteTranscription({
        sessionId: 'session-001',
        userId: 'admin-001',
        userRole: 'ADMIN',
      });

      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ sessionName: '会議録_20240101' }),
        })
      );
    });

    it('deletes the whole session and resets the job when media file still exists (Req 8)', async () => {
      await deleteTranscription({
        sessionId: 'session-001',
        userId: 'admin-001',
        userRole: 'ADMIN',
      });

      // Cascade delete MUST include the METADATA record (session is removed)
      const batchWriteCalls = mockedDocClientSend.mock.calls.filter(
        (call) => call[0]?.input?.RequestItems
      );
      const deletedKeys = batchWriteCalls.flatMap((call) =>
        (call[0].input.RequestItems.TestTable as Array<{ DeleteRequest: { Key: { SK: string } } }>).map(
          (req) => req.DeleteRequest.Key.SK
        )
      );
      expect(deletedKeys).toContain('METADATA');
      expect(deletedKeys).toEqual(
        expect.arrayContaining(['SEGMENT#seg-001', 'CORRECTION#corr-001', 'CONSENSUS#cons-001'])
      );

      // The linked transcription job is reset to IN_PROGRESS so it can be re-run
      expect(mockedUpdateJobStatus).toHaveBeenCalledWith('job-001', 'IN_PROGRESS');

      // AuditLog reflects the job was reset
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'TRANSCRIPTION_DELETED',
          metadata: expect.objectContaining({ jobReset: true }),
        })
      );
    });

    it('deletes the whole session without resetting the job when media file is already deleted (Req 7)', async () => {
      mockedGetSessionById.mockResolvedValue({ ...validSession, mediaFileDeleted: true });

      await deleteTranscription({
        sessionId: 'session-001',
        userId: 'admin-001',
        userRole: 'ADMIN',
      });

      // Cascade delete MUST include the METADATA record (session is removed)
      const batchWriteCalls = mockedDocClientSend.mock.calls.filter(
        (call) => call[0]?.input?.RequestItems
      );
      const deletedKeys = batchWriteCalls.flatMap((call) =>
        (call[0].input.RequestItems.TestTable as Array<{ DeleteRequest: { Key: { SK: string } } }>).map(
          (req) => req.DeleteRequest.Key.SK
        )
      );
      expect(deletedKeys).toContain('METADATA');

      // The job must NOT be reset (media file no longer exists)
      expect(mockedUpdateJobStatus).not.toHaveBeenCalled();

      // AuditLog reflects the job was not reset
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'TRANSCRIPTION_DELETED',
          metadata: expect.objectContaining({ jobReset: false }),
        })
      );
    });

    it('records PARTIAL_DELETION_FAILURE when DynamoDB cascade delete fails after S3 delete', async () => {
      // S3 delete succeeds
      mockS3Send.mockResolvedValue({});

      // Override docClient to fail on cascade delete (BatchWriteCommand)
      let callCount = 0;
      mockedDocClientSend.mockImplementation((command: any) => {
        if (command.input?.ProjectionExpression === 'GSI1PK') {
          return Promise.resolve({ Item: { GSI1PK: 'TEAM#team-001' } });
        }
        if (command.input?.ProjectionExpression === 'transcriptionJobId') {
          return Promise.resolve({ Item: { transcriptionJobId: 'job-001' } });
        }
        if (command.input?.KeyConditionExpression) {
          return Promise.resolve({
            Items: [
              { PK: 'SESSION#session-001', SK: 'METADATA' },
              { PK: 'SESSION#session-001', SK: 'SEGMENT#seg-001' },
            ],
          });
        }
        // BatchWriteCommand - fail
        callCount++;
        if (callCount >= 1) {
          return Promise.reject(new Error('DynamoDB BatchWrite timeout'));
        }
        return Promise.resolve({});
      });

      await expect(
        deleteTranscription({
          sessionId: 'session-001',
          userId: 'admin-001',
          userRole: 'ADMIN',
        })
      ).rejects.toThrow('DynamoDB BatchWrite timeout');

      // Should record PARTIAL_DELETION_FAILURE
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-001',
          actorRole: 'ADMIN',
          operationType: 'PARTIAL_DELETION_FAILURE',
          resourceId: 'session-001',
          resourceType: 'ReviewSession',
          metadata: expect.objectContaining({
            resourceName: '会議録_20240101',
            reason: expect.stringContaining('Partial deletion failure'),
          }),
        })
      );
    });
  });

  describe('deleteMediaFile - partial deletion failure', () => {
    const validMediaFile = {
      mediaFileId: 'media-002',
      filename: 'test-video.mp4',
      s3Key: 'media/media-002/test-video.mp4',
      contentType: 'video/mp4',
      fileSize: 5000000,
      uploadedBy: 'user-002',
      teamId: 'team-001',
      status: 'UPLOADED' as const,
      sessionId: 'session-002',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    it('records PARTIAL_DELETION_FAILURE when DynamoDB delete fails after S3 delete', async () => {
      mockedGetById.mockResolvedValue(validMediaFile);
      // S3 delete succeeds
      mockS3Send.mockResolvedValue({});
      // DynamoDB metadata delete fails
      mockedDeleteById.mockRejectedValue(new Error('DynamoDB delete failed'));

      await expect(
        deleteMediaFile({
          mediaFileId: 'media-002',
          user: adminUser,
        })
      ).rejects.toThrow('DynamoDB delete failed');

      // Should record PARTIAL_DELETION_FAILURE
      expect(mockedRecordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-001',
          actorRole: 'ADMIN',
          operationType: 'PARTIAL_DELETION_FAILURE',
          resourceId: 'media-002',
          resourceType: 'MediaFile',
          metadata: expect.objectContaining({
            resourceName: 'test-video.mp4',
            reason: expect.stringContaining('Partial deletion failure'),
          }),
        })
      );
    });
  });
});
