import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { S3Event } from 'aws-lambda';
import { extractMetadata, inferContentType } from './process-upload.js';

/**
 * Feature: メディアアップロード, Property 21: S3 イベントからのメタデータ抽出
 *
 * **Validates: Requirements 16.2**
 *
 * Verify that extractMetadata() correctly extracts mediaFileId, filename, fileSize
 * from S3 event records, and that inferContentType() correctly infers contentType
 * from file extensions.
 */
describe('Feature: メディアアップロード, Property 21: S3 イベントからのメタデータ抽出', () => {
  // Known extension-to-contentType mapping (mirrors the implementation)
  const KNOWN_EXTENSIONS: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    amr: 'audio/amr',
    webm: 'video/webm',
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
  };

  // Generator for simple filenames without special S3 encoding characters
  const simpleFilenameArb = fc
    .stringMatching(/^[a-zA-Z0-9_\-]{1,30}$/)
    .filter((s) => s.length > 0);

  // Generator for known file extensions
  const knownExtensionArb = fc.constantFrom(
    ...Object.keys(KNOWN_EXTENSIONS)
  );

  // Generator for unknown file extensions (not in the known map)
  const unknownExtensionArb = fc
    .stringMatching(/^[a-z]{1,5}$/)
    .filter((ext) => !(ext in KNOWN_EXTENSIONS) && ext.length > 0);

  // Generator for a filename with a known extension
  const filenameWithKnownExtArb = fc
    .tuple(simpleFilenameArb, knownExtensionArb)
    .map(([base, ext]) => `${base}.${ext}`);

  // Generator for a filename with an unknown extension
  const filenameWithUnknownExtArb = fc
    .tuple(simpleFilenameArb, unknownExtensionArb)
    .map(([base, ext]) => `${base}.${ext}`);

  // Generator for a filename without any extension
  const filenameWithoutExtArb = simpleFilenameArb.filter(
    (s) => !s.includes('.')
  );

  // Helper to build an S3Event from components
  function buildS3Event(params: {
    mediaFileId: string;
    filename: string;
    fileSize: number;
    bucketName: string;
  }): S3Event {
    const s3Key = `media/${params.mediaFileId}/${params.filename}`;
    return {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          awsRegion: 'ap-northeast-1',
          eventTime: new Date().toISOString(),
          eventName: 'ObjectCreated:Put',
          userIdentity: { principalId: 'EXAMPLE' },
          requestParameters: { sourceIPAddress: '127.0.0.1' },
          responseElements: {
            'x-amz-request-id': 'REQ123',
            'x-amz-id-2': 'ID2',
          },
          s3: {
            s3SchemaVersion: '1.0',
            configurationId: 'testConfig',
            bucket: {
              name: params.bucketName,
              ownerIdentity: { principalId: 'OWNER' },
              arn: `arn:aws:s3:::${params.bucketName}`,
            },
            object: {
              key: s3Key,
              size: params.fileSize,
              eTag: 'abc123',
              sequencer: '001',
            },
          },
        },
      ],
    };
  }

  // Combined arbitrary for S3 event test data
  const s3EventArb = fc
    .record({
      mediaFileId: fc.uuid(),
      filename: fc
        .stringMatching(/^[a-zA-Z0-9_\-]{1,20}\.[a-z0-9]{1,5}$/)
        .filter((s) => s.length > 0),
      fileSize: fc.integer({ min: 1, max: 5_000_000_000 }),
      bucketName: fc
        .stringMatching(/^[a-z0-9\-]{3,30}$/)
        .filter((s) => s.length >= 3),
    })
    .map((params) => ({
      ...params,
      event: buildS3Event(params),
      s3Key: `media/${params.mediaFileId}/${params.filename}`,
    }));

  it('correctly extracts mediaFileId from S3 key pattern media/{mediaFileId}/{filename}', () => {
    fc.assert(
      fc.property(s3EventArb, ({ event, mediaFileId }) => {
        const result = extractMetadata(event);
        expect(result).toHaveLength(1);
        expect(result[0].mediaFileId).toBe(mediaFileId);
      }),
      { numRuns: 100 }
    );
  });

  it('correctly extracts filename from S3 key', () => {
    fc.assert(
      fc.property(s3EventArb, ({ event, filename }) => {
        const result = extractMetadata(event);
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe(filename);
      }),
      { numRuns: 100 }
    );
  });

  it('correctly extracts fileSize from S3 event', () => {
    fc.assert(
      fc.property(s3EventArb, ({ event, fileSize }) => {
        const result = extractMetadata(event);
        expect(result).toHaveLength(1);
        expect(result[0].fileSize).toBe(fileSize);
      }),
      { numRuns: 100 }
    );
  });

  it('correctly infers contentType for known file extensions', () => {
    fc.assert(
      fc.property(filenameWithKnownExtArb, (filename) => {
        const contentType = inferContentType(filename);
        const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
        expect(contentType).toBe(KNOWN_EXTENSIONS[ext]);
      }),
      { numRuns: 100 }
    );
  });

  it('returns application/octet-stream for unknown file extensions', () => {
    fc.assert(
      fc.property(filenameWithUnknownExtArb, (filename) => {
        const contentType = inferContentType(filename);
        expect(contentType).toBe('application/octet-stream');
      }),
      { numRuns: 100 }
    );
  });

  it('returns application/octet-stream for filenames without extension', () => {
    fc.assert(
      fc.property(filenameWithoutExtArb, (filename) => {
        const contentType = inferContentType(filename);
        expect(contentType).toBe('application/octet-stream');
      }),
      { numRuns: 100 }
    );
  });

  it('contentType in extractMetadata matches inferContentType for the extracted filename', () => {
    fc.assert(
      fc.property(s3EventArb, ({ event }) => {
        const result = extractMetadata(event);
        expect(result).toHaveLength(1);
        const expectedContentType = inferContentType(result[0].filename);
        expect(result[0].contentType).toBe(expectedContentType);
      }),
      { numRuns: 100 }
    );
  });
});
