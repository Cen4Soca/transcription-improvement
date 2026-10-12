import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateUpload, ALLOWED_EXTENSIONS, MAX_FILE_SIZE } from './upload-service.js';

describe('Feature: media-upload, Property 20: アップロードバリデーション（ファイル形式・サイズ）', () => {
  /**
   * **Validates: Requirements 16.3, 16.4, 16.5, 16.6**
   *
   * Property: For any filename and file size combination, validation succeeds only when
   * the file extension is in the allowed list (mp3, wav, flac, ogg, m4a, amr, webm, mp4, mkv, avi, mov)
   * AND file size is between 1 byte and 2GB (inclusive). All other combinations must fail.
   */

  it('all allowed extensions (mp3, wav, flac, ogg, m4a, amr, webm, mp4, mkv, avi, mov) pass validation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_EXTENSIONS),
        fc.integer({ min: 1, max: MAX_FILE_SIZE }),
        (ext, size) => {
          const result = validateUpload({ filename: `test.${ext}`, fileSize: size });
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
          expect(result.errorCode).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('any non-allowed extension is rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter(
          (s) => !(ALLOWED_EXTENSIONS as readonly string[]).includes(s.toLowerCase())
        ),
        fc.integer({ min: 1, max: MAX_FILE_SIZE }),
        (ext, size) => {
          const result = validateUpload({ filename: `test.${ext}`, fileSize: size });
          expect(result.valid).toBe(false);
          expect(result.errorCode).toBe('UNSUPPORTED_FILE_FORMAT');
          expect(result.supportedFormats).toEqual([...ALLOWED_EXTENSIONS]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('files at or below 2GB pass size validation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_EXTENSIONS),
        fc.integer({ min: 1, max: MAX_FILE_SIZE }),
        (ext, size) => {
          const result = validateUpload({ filename: `test.${ext}`, fileSize: size });
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('files above 2GB are rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_EXTENSIONS),
        fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 2 }),
        (ext, size) => {
          const result = validateUpload({ filename: `test.${ext}`, fileSize: size });
          expect(result.valid).toBe(false);
          expect(result.errorCode).toBe('FILE_SIZE_EXCEEDED');
        }
      ),
      { numRuns: 100 }
    );
  });
});
