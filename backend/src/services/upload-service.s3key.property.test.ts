import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateS3Key } from './upload-service.js';

/**
 * Feature: メディアアップロード, Property 22: S3 キー生成パターン
 *
 * **Validates: Requirements 16.8, 17.11, 20.6**
 *
 * Verifies that generateS3Key produces keys matching the pattern
 * `media/{mediaFileId}/{filename}`, that the components can be extracted
 * back from the key, and that the key never contains double slashes or
 * starts with a slash.
 */
describe('Feature: メディアアップロード, Property 22: S3 キー生成パターン', () => {
  const mediaFileIdArb = fc.uuid();
  const filenameArb = fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => !s.includes('/') && s.trim().length > 0);

  /**
   * **Validates: Requirements 16.8**
   * Generated S3 key always matches pattern `media/{mediaFileId}/{filename}`
   */
  it('generated S3 key always matches pattern media/{mediaFileId}/{filename}', () => {
    fc.assert(
      fc.property(mediaFileIdArb, filenameArb, (mediaFileId, filename) => {
        const key = generateS3Key(mediaFileId, filename);
        expect(key).toBe(`media/${mediaFileId}/${filename}`);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.8, 17.11**
   * The mediaFileId and filename can be extracted back from the key
   */
  it('mediaFileId and filename can be extracted back from the generated key', () => {
    fc.assert(
      fc.property(mediaFileIdArb, filenameArb, (mediaFileId, filename) => {
        const key = generateS3Key(mediaFileId, filename);
        const parts = key.split('/');
        // key format: media/{mediaFileId}/{filename}
        expect(parts[0]).toBe('media');
        expect(parts[1]).toBe(mediaFileId);
        expect(parts.slice(2).join('/')).toBe(filename);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.8, 20.6**
   * Key never contains double slashes or starts with a slash
   */
  it('key never contains double slashes or starts with a slash', () => {
    fc.assert(
      fc.property(mediaFileIdArb, filenameArb, (mediaFileId, filename) => {
        const key = generateS3Key(mediaFileId, filename);
        expect(key).not.toMatch(/\/\//);
        expect(key.startsWith('/')).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
