import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

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

import { getMediaUrl, getMediaFileForSession } from './media-service.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import type { MediaFile, ScanStatus } from '../types/media-file.js';

const mockedGetBySessionId = vi.mocked(mediaFileRepository.getBySessionId);

/**
 * Arbitrary that generates a valid MediaFile record with a specified scanStatus.
 */
function mediaFileArb(scanStatus: ScanStatus | undefined): fc.Arbitrary<MediaFile> {
  return fc.record({
    mediaFileId: fc.uuid(),
    filename: fc.string({ minLength: 1, maxLength: 50 }).map((s) => s.replace(/[/\\]/g, '_') + '.mp3'),
    s3Key: fc.uuid().map((id) => `media/${id}/audio.mp3`),
    contentType: fc.constantFrom('audio/mpeg', 'audio/wav', 'video/mp4'),
    fileSize: fc.integer({ min: 1, max: 2_000_000_000 }),
    uploadedBy: fc.uuid(),
    teamId: fc.option(fc.uuid(), { nil: undefined }),
    status: fc.constantFrom('UPLOADING' as const, 'UPLOADED' as const, 'PROCESSING' as const, 'COMPLETED' as const),
    scanStatus: fc.constant(scanStatus),
    sessionId: fc.uuid().map((id) => id as string | undefined),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
    updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
  });
}

describe('Feature: media-service, Property 47: スキャン前ファイルアクセスの拒否', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is PENDING, the system refuses to generate signed media URLs
   * by throwing a 403 FORBIDDEN error.
   */
  it('scanStatus が PENDING のとき Signed URL 生成を拒否する', async () => {
    await fc.assert(
      fc.asyncProperty(
        mediaFileArb('PENDING'),
        fc.uuid(),
        async (mediaFile, sessionId) => {
          mockedGetBySessionId.mockResolvedValue(mediaFile);

          await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject({
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is undefined (treated as PENDING), the system refuses to generate
   * signed media URLs by throwing a 403 FORBIDDEN error.
   */
  it('scanStatus が undefined のとき Signed URL 生成を拒否する', async () => {
    await fc.assert(
      fc.asyncProperty(
        mediaFileArb(undefined),
        fc.uuid(),
        async (mediaFile, sessionId) => {
          mockedGetBySessionId.mockResolvedValue(mediaFile);

          await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject({
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is CLEAN, the system allows URL generation and returns
   * a valid S3 pre-signed URL (amazonaws.com host) with an expiration time.
   */
  it('scanStatus が CLEAN のとき Signed URL 生成を許可する', async () => {
    await fc.assert(
      fc.asyncProperty(
        mediaFileArb('CLEAN'),
        fc.uuid(),
        async (mediaFile, sessionId) => {
          mockedGetBySessionId.mockResolvedValue(mediaFile);

          const result = await getMediaUrl(sessionId);

          // Host must be *.amazonaws.com to satisfy the co-host CloudFront CSP
          expect(result.data.url).toContain('amazonaws.com');
          expect(result.data.url).toContain(mediaFile.s3Key);
          expect(result.data.expiresAt).toBeDefined();
          const expiresAt = new Date(result.data.expiresAt).getTime();
          expect(expiresAt).toBeGreaterThan(Date.now());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is INFECTED, the system refuses to generate signed media URLs
   * by throwing a 403 FORBIDDEN error.
   */
  it('scanStatus が INFECTED のとき Signed URL 生成を拒否する', async () => {
    await fc.assert(
      fc.asyncProperty(
        mediaFileArb('INFECTED'),
        fc.uuid(),
        async (mediaFile, sessionId) => {
          mockedGetBySessionId.mockResolvedValue(mediaFile);

          await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject({
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
