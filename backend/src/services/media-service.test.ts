import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env vars before module import so module-level constants pick them up
process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
process.env.AWS_REGION = 'ap-northeast-1';

vi.mock('../repositories/media-file-repository.js', () => ({
  getBySessionId: vi.fn(),
  getById: vi.fn(),
  updateSessionId: vi.fn().mockResolvedValue(undefined),
}));

// Fallback resolution path (session -> transcriptionJob -> mediaFileId) used
// when the direct MediaFile.sessionId link is missing (getBySessionId null).
vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
}));

vi.mock('../repositories/transcription-job-repository.js', () => ({
  getById: vi.fn(),
}));

// S3 pre-signed URL generator (host: s3.<region>.amazonaws.com) so playback stays
// within the co-host CloudFront distribution's CSP (media-src https://*.amazonaws.com).
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async (_client: unknown, command: { input: { Bucket: string; Key: string } }) =>
      `https://s3.ap-northeast-1.amazonaws.com/${command.input.Bucket}/${command.input.Key}?X-Amz-Signature=abc&X-Amz-Expires=300`
  ),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function () { return {}; }),
  GetObjectCommand: vi.fn().mockImplementation(function (input) { return { input }; }),
}));

import { getMediaUrl, getMediaFileForSession, generateSignedUrl } from './media-service.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import * as sessionRepository from '../repositories/session-repository.js';
import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import type { MediaFile } from '../types/media-file.js';

const mockedGetBySessionId = vi.mocked(mediaFileRepository.getBySessionId);
const mockedGetById = vi.mocked(mediaFileRepository.getById);
const mockedUpdateSessionId = vi.mocked(mediaFileRepository.updateSessionId);
const mockedGetSessionById = vi.mocked(sessionRepository.getSessionById);
const mockedJobGetById = vi.mocked(transcriptionJobRepository.getById);

function buildMediaFile(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    mediaFileId: 'media-001',
    filename: 'audio.mp3',
    s3Key: 'media/media-001/audio.mp3',
    contentType: 'audio/mpeg',
    fileSize: 1024,
    uploadedBy: 'user-001',
    status: 'UPLOADED',
    scanStatus: 'CLEAN',
    sessionId: 'session-123',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('media-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMediaFileForSession', () => {
    it('throws 404 when no media file found and the fallback cannot resolve one', async () => {
      // Direct link missing AND the fallback (session -> job -> mediaFile)
      // cannot resolve: the session itself does not exist.
      mockedGetBySessionId.mockResolvedValue(null);
      mockedGetSessionById.mockResolvedValue(null);

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Media file not found',
      });
    });

    it('throws 403 when scanStatus is PENDING', async () => {
      mockedGetBySessionId.mockResolvedValue({
        mediaFileId: 'media-001',
        filename: 'audio.mp3',
        s3Key: 'media/media-001/audio.mp3',
        contentType: 'audio/mpeg',
        fileSize: 1024,
        uploadedBy: 'user-001',
        status: 'UPLOADED',
        scanStatus: 'PENDING',
        sessionId: 'session-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This file cannot be accessed until the malware scan is complete.',
      });
    });

    it('throws 403 when scanStatus is undefined (treated as PENDING)', async () => {
      mockedGetBySessionId.mockResolvedValue({
        mediaFileId: 'media-001',
        filename: 'audio.mp3',
        s3Key: 'media/media-001/audio.mp3',
        contentType: 'audio/mpeg',
        fileSize: 1024,
        uploadedBy: 'user-001',
        status: 'UPLOADED',
        scanStatus: undefined,
        sessionId: 'session-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This file cannot be accessed until the malware scan is complete.',
      });
    });

    it('throws 403 when scanStatus is INFECTED', async () => {
      mockedGetBySessionId.mockResolvedValue({
        mediaFileId: 'media-001',
        filename: 'audio.mp3',
        s3Key: 'media/media-001/audio.mp3',
        contentType: 'audio/mpeg',
        fileSize: 1024,
        uploadedBy: 'user-001',
        status: 'UPLOADED',
        scanStatus: 'INFECTED',
        sessionId: 'session-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This file cannot be accessed because malware was detected.',
      });
    });

    it('returns media file when scanStatus is CLEAN', async () => {
      const mediaFile = {
        mediaFileId: 'media-001',
        filename: 'audio.mp3',
        s3Key: 'media/media-001/audio.mp3',
        contentType: 'audio/mpeg',
        fileSize: 1024,
        uploadedBy: 'user-001',
        status: 'UPLOADED' as const,
        scanStatus: 'CLEAN' as const,
        sessionId: 'session-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockedGetBySessionId.mockResolvedValue(mediaFile);

      const result = await getMediaFileForSession('session-123');
      expect(result).toEqual(mediaFile);
    });

    // --- Fallback resolution + link compensation (self-heal) ---

    it('resolves via fallback (session -> job -> mediaFileId), compensates the link, and returns the MediaFile', async () => {
      // Direct link missing: getBySessionId returns null.
      mockedGetBySessionId.mockResolvedValue(null);
      // Fallback chain: session -> transcriptionJobId -> job.mediaFileId -> MediaFile.
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        transcriptionJobId: 'job-123',
        name: 'Upload Session',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedJobGetById.mockResolvedValue({
        jobId: 'job-123',
        transcribeJobName: 'tr-job-123',
        mediaFileId: 'media-001',
        status: 'COMPLETED',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 2,
        startedBy: 'user-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      const resolved = buildMediaFile({ sessionId: undefined });
      mockedGetById.mockResolvedValue(resolved);

      const result = await getMediaFileForSession('session-123');

      expect(mockedGetById).toHaveBeenCalledWith('media-001');
      // The broken link is compensated so future getBySessionId lookups succeed.
      expect(mockedUpdateSessionId).toHaveBeenCalledWith('media-001', 'session-123');
      expect(result).toEqual(resolved);
    });

    it('throws 404 when the fallback session has no transcriptionJobId', async () => {
      mockedGetBySessionId.mockResolvedValue(null);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        // no transcriptionJobId
        name: 'Orphan Session',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
      expect(mockedUpdateSessionId).not.toHaveBeenCalled();
    });

    it('throws 404 when the fallback job cannot be found', async () => {
      mockedGetBySessionId.mockResolvedValue(null);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        transcriptionJobId: 'job-123',
        name: 'Session',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedJobGetById.mockResolvedValue(null);

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
      expect(mockedUpdateSessionId).not.toHaveBeenCalled();
    });

    it('throws 404 when the fallback resolves a mediaFileId but the MediaFile is gone', async () => {
      mockedGetBySessionId.mockResolvedValue(null);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        transcriptionJobId: 'job-123',
        name: 'Session',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedJobGetById.mockResolvedValue({
        jobId: 'job-123',
        transcribeJobName: 'tr-job-123',
        mediaFileId: 'media-001',
        status: 'COMPLETED',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 2,
        startedBy: 'user-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedGetById.mockResolvedValue(null);

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
      expect(mockedUpdateSessionId).not.toHaveBeenCalled();
    });

    it('applies the scanStatus gate to a fallback-resolved MediaFile: PENDING -> 403 MEDIA_SCAN_PENDING', async () => {
      mockedGetBySessionId.mockResolvedValue(null);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        transcriptionJobId: 'job-123',
        name: 'Session',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedJobGetById.mockResolvedValue({
        jobId: 'job-123',
        transcribeJobName: 'tr-job-123',
        mediaFileId: 'media-001',
        status: 'COMPLETED',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 2,
        startedBy: 'user-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedGetById.mockResolvedValue(
        buildMediaFile({ scanStatus: 'PENDING', sessionId: undefined })
      );

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This file cannot be accessed until the malware scan is complete.',
      });
      // The link is still compensated even when the gate later rejects.
      expect(mockedUpdateSessionId).toHaveBeenCalledWith('media-001', 'session-123');
    });

    it('applies the scanStatus gate to a fallback-resolved MediaFile: INFECTED -> 403 MEDIA_MALWARE_DETECTED', async () => {
      mockedGetBySessionId.mockResolvedValue(null);
      mockedGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        transcriptionJobId: 'job-123',
        name: 'Session',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedJobGetById.mockResolvedValue({
        jobId: 'job-123',
        transcribeJobName: 'tr-job-123',
        mediaFileId: 'media-001',
        status: 'COMPLETED',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 2,
        startedBy: 'user-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockedGetById.mockResolvedValue(
        buildMediaFile({ scanStatus: 'INFECTED', sessionId: undefined })
      );

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This file cannot be accessed because malware was detected.',
      });
    });

    it('does NOT use the fallback when the direct link resolves (getBySessionId non-null)', async () => {
      mockedGetBySessionId.mockResolvedValue(buildMediaFile());

      await getMediaFileForSession('session-123');

      // Linked path is untouched by the fallback.
      expect(mockedGetSessionById).not.toHaveBeenCalled();
      expect(mockedJobGetById).not.toHaveBeenCalled();
      expect(mockedGetById).not.toHaveBeenCalled();
      expect(mockedUpdateSessionId).not.toHaveBeenCalled();
    });
  });

  describe('generateSignedUrl', () => {
    it('generates an S3 pre-signed URL on the amazonaws.com endpoint', async () => {
      const result = await generateSignedUrl('media/media-001/audio.mp3');

      // Host must be *.amazonaws.com to satisfy the co-host CloudFront CSP
      expect(result.url).toContain('amazonaws.com');
      expect(result.url).toContain('test-media-bucket/media/media-001/audio.mp3');
      expect(result.expiresAt).toBeDefined();
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('throws 500 when s3Key is empty', async () => {
      await expect(generateSignedUrl('')).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });
  });

  describe('getMediaUrl', () => {
    it('returns data with url and expiresAt when scanStatus is CLEAN', async () => {
      mockedGetBySessionId.mockResolvedValue({
        mediaFileId: 'media-001',
        filename: 'audio.mp3',
        s3Key: 'media/media-001/audio.mp3',
        contentType: 'audio/mpeg',
        fileSize: 1024,
        uploadedBy: 'user-001',
        status: 'UPLOADED',
        scanStatus: 'CLEAN',
        sessionId: 'session-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await getMediaUrl('session-123');

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('url');
      expect(result.data).toHaveProperty('expiresAt');
      expect(result.data.url).toContain('amazonaws.com');
      expect(result.data.url).toContain('test-media-bucket/media/media-001/audio.mp3');
    });

    it('signed URL expires approximately 300 seconds from now', async () => {
      mockedGetBySessionId.mockResolvedValue({
        mediaFileId: 'media-001',
        filename: 'audio.mp3',
        s3Key: 'media/media-001/audio.mp3',
        contentType: 'audio/mpeg',
        fileSize: 1024,
        uploadedBy: 'user-001',
        status: 'UPLOADED',
        scanStatus: 'CLEAN',
        sessionId: 'session-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const before = Date.now();
      const result = await getMediaUrl('session-123');
      const after = Date.now();

      const expiresAtMs = new Date(result.data.expiresAt).getTime();
      // Should be approximately 300 seconds (300000ms) from now
      expect(expiresAtMs - before).toBeGreaterThanOrEqual(299000);
      expect(expiresAtMs - after).toBeLessThanOrEqual(301000);
    });
  });
});
