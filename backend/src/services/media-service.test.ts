import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env vars before module import so module-level constants pick them up
process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
process.env.AWS_REGION = 'ap-northeast-1';

vi.mock('../repositories/media-file-repository.js', () => ({
  getBySessionId: vi.fn(),
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
  S3Client: vi.fn().mockImplementation(() => ({})),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { getMediaUrl, getMediaFileForSession, generateSignedUrl } from './media-service.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';

const mockedGetBySessionId = vi.mocked(mediaFileRepository.getBySessionId);

describe('media-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMediaFileForSession', () => {
    it('throws 404 when no media file found for session', async () => {
      mockedGetBySessionId.mockResolvedValue(null);

      await expect(getMediaFileForSession('session-123')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'メディアファイルが見つかりません。',
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
        message: 'マルウェアスキャン完了前のファイルにはアクセスできません',
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
        message: 'マルウェアスキャン完了前のファイルにはアクセスできません',
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
        message: 'マルウェアが検出されたファイルにはアクセスできません',
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
