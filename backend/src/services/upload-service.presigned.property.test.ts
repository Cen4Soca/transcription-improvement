import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.stubEnv('MEDIA_BUCKET_NAME', 'test-media-bucket');

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url-mock'),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation((params) => params),
}));

const { PRESIGNED_URL_EXPIRY_SECONDS, generatePresignedUrl } = await import('./upload-service.js');

/**
 * Feature: media-upload, Property 35: PresignedURL 有効期限の制限
 *
 * **Validates: Requirements 16.7**
 *
 * The presigned URL expiry constant must be exactly 300 seconds,
 * and the expiresAt timestamp returned by generatePresignedUrl must be
 * within 300 seconds of the current time.
 */
describe('Feature: media-upload, Property 35: PresignedURL 有効期限の制限', () => {

  /**
   * **Validates: Requirements 16.7**
   * The PRESIGNED_URL_EXPIRY_SECONDS constant is exactly 300.
   */
  it('PRESIGNED_URL_EXPIRY_SECONDS is exactly 300 seconds', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(PRESIGNED_URL_EXPIRY_SECONDS).toBe(300);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.7**
   * The expiresAt timestamp returned by generatePresignedUrl is within 300 seconds of the current time.
   */
  it('expiresAt is within 300 seconds of the current time', async () => {
    const mediaFileIdArb = fc.uuid();
    const filenameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
      s => !s.includes('/') && s.length > 0 && s.includes('.')
    );
    const contentTypeArb = fc.constantFrom('audio/mpeg', 'video/mp4', 'audio/wav', 'audio/flac');
    const userIdArb = fc.uuid();

    await fc.assert(
      fc.asyncProperty(
        mediaFileIdArb,
        filenameArb,
        contentTypeArb,
        userIdArb,
        async (mediaFileId, filename, contentType, userId) => {
          const beforeMs = Date.now();
          const result = await generatePresignedUrl({
            mediaFileId,
            filename,
            contentType,
            userId,
          });
          const afterMs = Date.now();

          const expiresAtMs = new Date(result.expiresAt).getTime();

          // expiresAt should be approximately now + 300 seconds
          // Allow a small tolerance for execution time
          const expectedMinMs = beforeMs + PRESIGNED_URL_EXPIRY_SECONDS * 1000;
          const expectedMaxMs = afterMs + PRESIGNED_URL_EXPIRY_SECONDS * 1000;

          expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMinMs);
          expect(expiresAtMs).toBeLessThanOrEqual(expectedMaxMs);

          // Verify it's a valid ISO 8601 string
          expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
