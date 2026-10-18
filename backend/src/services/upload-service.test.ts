import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  validateUpload,
  generateS3Key,
  extractExtension,
  generateMediaFileId,
  generatePresignedUrl,
  setS3Client,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  PRESIGNED_URL_EXPIRY_SECONDS,
} from './upload-service.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/media/test-id/file.mp3?X-Amz-Signature=abc'),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

describe('upload-service', () => {
  describe('extractExtension', () => {
    test('extracts extension from a normal filename', () => {
      expect(extractExtension('audio.mp3')).toBe('mp3');
    });

    test('extracts extension case-insensitively', () => {
      expect(extractExtension('audio.MP3')).toBe('mp3');
      expect(extractExtension('video.MKV')).toBe('mkv');
    });

    test('returns empty string for filename without extension', () => {
      expect(extractExtension('noextension')).toBe('');
    });

    test('returns empty string for filename ending with dot', () => {
      expect(extractExtension('file.')).toBe('');
    });

    test('handles multiple dots correctly', () => {
      expect(extractExtension('my.file.wav')).toBe('wav');
    });
  });

  describe('validateUpload', () => {
    test('accepts valid audio file', () => {
      const result = validateUpload({ filename: 'recording.mp3', fileSize: 1024 });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('accepts valid video file', () => {
      const result = validateUpload({ filename: 'video.mp4', fileSize: 1024 * 1024 });
      expect(result.valid).toBe(true);
    });

    test('accepts file at exactly 2GB', () => {
      const result = validateUpload({ filename: 'large.wav', fileSize: MAX_FILE_SIZE });
      expect(result.valid).toBe(true);
    });

    test('rejects unsupported file format', () => {
      const result = validateUpload({ filename: 'document.pdf', fileSize: 1024 });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNSUPPORTED_FILE_FORMAT');
      expect(result.supportedFormats).toEqual([...ALLOWED_EXTENSIONS]);
    });

    test('rejects file without extension', () => {
      const result = validateUpload({ filename: 'noext', fileSize: 1024 });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNSUPPORTED_FILE_FORMAT');
    });

    test('rejects file exceeding 2GB', () => {
      const result = validateUpload({ filename: 'huge.mp3', fileSize: MAX_FILE_SIZE + 1 });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('FILE_SIZE_EXCEEDED');
      expect(result.error).toContain('2GB');
    });

    test('rejects file with zero size', () => {
      const result = validateUpload({ filename: 'empty.mp3', fileSize: 0 });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_FILE_SIZE');
    });

    test('rejects file with negative size', () => {
      const result = validateUpload({ filename: 'bad.mp3', fileSize: -1 });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_FILE_SIZE');
    });

    test('accepts all allowed extensions', () => {
      for (const ext of ALLOWED_EXTENSIONS) {
        const result = validateUpload({ filename: `test.${ext}`, fileSize: 1024 });
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('generateS3Key', () => {
    test('generates correct S3 key pattern', () => {
      const key = generateS3Key('abc-123', 'recording.mp3');
      expect(key).toBe('media/abc-123/recording.mp3');
    });

    test('preserves filename with special characters', () => {
      const key = generateS3Key('id-456', '会議録 2024.wav');
      expect(key).toBe('media/id-456/会議録 2024.wav');
    });

    test('generates key with UUID-style mediaFileId', () => {
      const key = generateS3Key('550e8400-e29b-41d4-a716-446655440000', 'test.flac');
      expect(key).toBe('media/550e8400-e29b-41d4-a716-446655440000/test.flac');
    });
  });

  describe('generateMediaFileId', () => {
    test('generates a valid UUID v4 string', () => {
      const id = generateMediaFileId();
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidV4Regex);
    });

    test('generates unique IDs on each call', () => {
      const id1 = generateMediaFileId();
      const id2 = generateMediaFileId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('PRESIGNED_URL_EXPIRY_SECONDS', () => {
    test('is set to 300 seconds (5 minutes)', () => {
      expect(PRESIGNED_URL_EXPIRY_SECONDS).toBe(300);
    });
  });

  describe('generatePresignedUrl', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test('throws CONFIGURATION_ERROR when MEDIA_BUCKET_NAME is empty', async () => {
      // MEDIA_BUCKET_NAME is '' at module load since env var is not set in test
      await expect(
        generatePresignedUrl({
          mediaFileId: 'test-uuid',
          filename: 'file.mp3',
          contentType: 'audio/mpeg',
          userId: 'user-001',
        })
      ).rejects.toMatchObject({
        code: 'CONFIGURATION_ERROR',
        statusCode: 500,
      });
    });

    test('generates presigned URL with correct parameters when bucket is configured', async () => {
      // Use vi.resetModules to re-import with env set
      vi.resetModules();
      process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';

      // Re-mock after reset
      vi.doMock('@aws-sdk/s3-request-presigner', () => ({
        getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-media-bucket/media/uuid-123/audio.mp3?signed'),
      }));

      const { generatePresignedUrl: genUrl, setS3Client: setClient } = await import('./upload-service.js');
      const { getSignedUrl: mockedGetSignedUrl } = await import('@aws-sdk/s3-request-presigner');

      setClient({} as never);

      const result = await genUrl({
        mediaFileId: 'uuid-123',
        filename: 'audio.mp3',
        contentType: 'audio/mpeg',
        userId: 'user-001',
        teamId: 'team-001',
      });

      expect(result.presignedUrl).toContain('https://');
      expect(result.mediaFileId).toBe('uuid-123');
      expect(result.s3Key).toBe('media/uuid-123/audio.mp3');
      expect(result.expiresAt).toBeDefined();

      // Verify getSignedUrl was called with 300 second expiry
      expect(mockedGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 300 }
      );

      // Verify expiresAt is approximately 300 seconds in the future
      const expiresAtMs = new Date(result.expiresAt).getTime();
      const nowMs = Date.now();
      expect(expiresAtMs).toBeGreaterThan(nowMs + 290 * 1000);
      expect(expiresAtMs).toBeLessThan(nowMs + 310 * 1000);

      // Cleanup
      delete process.env.MEDIA_BUCKET_NAME;
      vi.resetModules();
    });
  });
});
