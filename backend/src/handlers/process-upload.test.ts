import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Event } from 'aws-lambda';
import { handler, extractMetadata, inferContentType } from './process-upload.js';

const mockSend = vi.fn();
const mockEventBridgeSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: (...args: unknown[]) => mockEventBridgeSend(...args) })),
  PutEventsCommand: vi.fn((input) => ({ ...input, _type: 'PutEvents' })),
}));

describe('process-upload handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventBridgeSend.mockResolvedValue({});
  });

  const createS3Event = (
    key: string,
    size: number,
    bucketName = 'test-media-bucket'
  ): S3Event => ({
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'ap-northeast-1',
        eventTime: '2024-01-15T10:30:00.000Z',
        eventName: 'ObjectCreated:Put',
        userIdentity: { principalId: 'EXAMPLE' },
        requestParameters: { sourceIPAddress: '127.0.0.1' },
        responseElements: {
          'x-amz-request-id': 'EXAMPLE123',
          'x-amz-id-2': 'EXAMPLE123/abc',
        },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'testConfigRule',
          bucket: {
            name: bucketName,
            ownerIdentity: { principalId: 'EXAMPLE' },
            arn: `arn:aws:s3:::${bucketName}`,
          },
          object: {
            key,
            size,
            eTag: '0123456789abcdef',
            sequencer: '0A1B2C3D4E5F678901',
          },
        },
      },
    ],
  });

  describe('extractMetadata', () => {
    it('should extract mediaFileId and filename from S3 key pattern', () => {
      const event = createS3Event('media/abc-123/meeting.mp3', 1024000);
      const result = extractMetadata(event);

      expect(result).toHaveLength(1);
      expect(result[0].mediaFileId).toBe('abc-123');
      expect(result[0].filename).toBe('meeting.mp3');
      expect(result[0].s3Key).toBe('media/abc-123/meeting.mp3');
      expect(result[0].fileSize).toBe(1024000);
      expect(result[0].bucketName).toBe('test-media-bucket');
    });

    it('should infer content type from file extension', () => {
      const event = createS3Event('media/abc-123/audio.wav', 2048000);
      const result = extractMetadata(event);

      expect(result[0].contentType).toBe('audio/wav');
    });

    it('should handle URL-encoded S3 keys', () => {
      const event = createS3Event('media/abc-123/%E4%BC%9A%E8%AD%B0.mp3', 512000);
      const result = extractMetadata(event);

      expect(result[0].filename).toBe('会議.mp3');
      expect(result[0].s3Key).toBe('media/abc-123/会議.mp3');
    });

    it('should handle filenames with subdirectories', () => {
      const event = createS3Event('media/abc-123/subdir/file.mp4', 4096000);
      const result = extractMetadata(event);

      expect(result[0].filename).toBe('subdir/file.mp4');
      expect(result[0].mediaFileId).toBe('abc-123');
    });

    it('should handle multiple records in a single event', () => {
      const event: S3Event = {
        Records: [
          {
            eventVersion: '2.1',
            eventSource: 'aws:s3',
            awsRegion: 'ap-northeast-1',
            eventTime: '2024-01-15T10:30:00.000Z',
            eventName: 'ObjectCreated:Put',
            userIdentity: { principalId: 'EXAMPLE' },
            requestParameters: { sourceIPAddress: '127.0.0.1' },
            responseElements: {
              'x-amz-request-id': 'REQ1',
              'x-amz-id-2': 'ID1',
            },
            s3: {
              s3SchemaVersion: '1.0',
              configurationId: 'testConfigRule',
              bucket: {
                name: 'test-bucket',
                ownerIdentity: { principalId: 'EXAMPLE' },
                arn: 'arn:aws:s3:::test-bucket',
              },
              object: {
                key: 'media/id-1/file1.mp3',
                size: 100,
                eTag: 'etag1',
                sequencer: 'seq1',
              },
            },
          },
          {
            eventVersion: '2.1',
            eventSource: 'aws:s3',
            awsRegion: 'ap-northeast-1',
            eventTime: '2024-01-15T10:31:00.000Z',
            eventName: 'ObjectCreated:Put',
            userIdentity: { principalId: 'EXAMPLE' },
            requestParameters: { sourceIPAddress: '127.0.0.1' },
            responseElements: {
              'x-amz-request-id': 'REQ2',
              'x-amz-id-2': 'ID2',
            },
            s3: {
              s3SchemaVersion: '1.0',
              configurationId: 'testConfigRule',
              bucket: {
                name: 'test-bucket',
                ownerIdentity: { principalId: 'EXAMPLE' },
                arn: 'arn:aws:s3:::test-bucket',
              },
              object: {
                key: 'media/id-2/file2.wav',
                size: 200,
                eTag: 'etag2',
                sequencer: 'seq2',
              },
            },
          },
        ],
      };

      const result = extractMetadata(event);

      expect(result).toHaveLength(2);
      expect(result[0].mediaFileId).toBe('id-1');
      expect(result[0].filename).toBe('file1.mp3');
      expect(result[1].mediaFileId).toBe('id-2');
      expect(result[1].filename).toBe('file2.wav');
    });
  });

  describe('inferContentType', () => {
    it('should return correct content type for known extensions', () => {
      expect(inferContentType('file.mp3')).toBe('audio/mpeg');
      expect(inferContentType('file.wav')).toBe('audio/wav');
      expect(inferContentType('file.flac')).toBe('audio/flac');
      expect(inferContentType('file.ogg')).toBe('audio/ogg');
      expect(inferContentType('file.m4a')).toBe('audio/mp4');
      expect(inferContentType('file.amr')).toBe('audio/amr');
      expect(inferContentType('file.webm')).toBe('video/webm');
      expect(inferContentType('file.mp4')).toBe('video/mp4');
      expect(inferContentType('file.mkv')).toBe('video/x-matroska');
      expect(inferContentType('file.avi')).toBe('video/x-msvideo');
      expect(inferContentType('file.mov')).toBe('video/quicktime');
    });

    it('should return application/octet-stream for unknown extensions', () => {
      expect(inferContentType('file.xyz')).toBe('application/octet-stream');
    });

    it('should return application/octet-stream for files without extension', () => {
      expect(inferContentType('noextension')).toBe('application/octet-stream');
    });

    it('should be case-insensitive', () => {
      expect(inferContentType('file.MP3')).toBe('audio/mpeg');
      expect(inferContentType('file.WAV')).toBe('audio/wav');
    });
  });

  describe('handler', () => {
    it('should save MediaFile record to DynamoDB with correct keys', async () => {
      mockSend.mockResolvedValue({});

      const event = createS3Event('media/abc-123/meeting.mp3', 1024000);
      await handler(event);

      expect(mockSend).toHaveBeenCalledOnce();

      const command = mockSend.mock.calls[0][0];
      const input = command.input;

      expect(input.TableName).toBe('TestTable');
      expect(input.Item.PK).toBe('MEDIA#abc-123');
      expect(input.Item.SK).toBe('METADATA');
      expect(input.Item.entityType).toBe('MediaFile');
      expect(input.Item.mediaFileId).toBe('abc-123');
      expect(input.Item.filename).toBe('meeting.mp3');
      expect(input.Item.s3Key).toBe('media/abc-123/meeting.mp3');
      expect(input.Item.s3Bucket).toBe('test-media-bucket');
      expect(input.Item.contentType).toBe('audio/mpeg');
      expect(input.Item.fileSize).toBe(1024000);
      expect(input.Item.uploadedBy).toBe('system');
      expect(input.Item.uploadedAt).toBeDefined();
      expect(input.Item.scanStatus).toBe('PENDING');
      expect(input.Item.status).toBe('UPLOADED');
      expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
    });

    it('should set uploadedAt and createdAt as ISO 8601 UTC timestamps', async () => {
      mockSend.mockResolvedValue({});

      const event = createS3Event('media/abc-123/meeting.mp3', 1024000);
      await handler(event);

      const command = mockSend.mock.calls[0][0];
      const item = command.input.Item;

      // Verify ISO 8601 format (e.g., 2024-01-15T10:30:00.000Z)
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(item.uploadedAt).toMatch(iso8601Regex);
      expect(item.createdAt).toMatch(iso8601Regex);
      expect(item.updatedAt).toMatch(iso8601Regex);
    });

    it('should handle ConditionalCheckFailedException gracefully (idempotency)', async () => {
      const conditionalError = new Error('The conditional request failed');
      conditionalError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValue(conditionalError);

      const event = createS3Event('media/abc-123/meeting.mp3', 1024000);

      // Should not throw
      await expect(handler(event)).resolves.toBeUndefined();
    });

    it('should re-throw non-conditional errors', async () => {
      const otherError = new Error('Service unavailable');
      otherError.name = 'ServiceUnavailableException';
      mockSend.mockRejectedValue(otherError);

      const event = createS3Event('media/abc-123/meeting.mp3', 1024000);

      await expect(handler(event)).rejects.toThrow('Service unavailable');
    });

    it('should process multiple records in a single event', async () => {
      mockSend.mockResolvedValue({});

      const event: S3Event = {
        Records: [
          {
            eventVersion: '2.1',
            eventSource: 'aws:s3',
            awsRegion: 'ap-northeast-1',
            eventTime: '2024-01-15T10:30:00.000Z',
            eventName: 'ObjectCreated:Put',
            userIdentity: { principalId: 'EXAMPLE' },
            requestParameters: { sourceIPAddress: '127.0.0.1' },
            responseElements: {
              'x-amz-request-id': 'REQ1',
              'x-amz-id-2': 'ID1',
            },
            s3: {
              s3SchemaVersion: '1.0',
              configurationId: 'testConfigRule',
              bucket: {
                name: 'test-bucket',
                ownerIdentity: { principalId: 'EXAMPLE' },
                arn: 'arn:aws:s3:::test-bucket',
              },
              object: {
                key: 'media/id-1/file1.mp3',
                size: 100,
                eTag: 'etag1',
                sequencer: 'seq1',
              },
            },
          },
          {
            eventVersion: '2.1',
            eventSource: 'aws:s3',
            awsRegion: 'ap-northeast-1',
            eventTime: '2024-01-15T10:31:00.000Z',
            eventName: 'ObjectCreated:Put',
            userIdentity: { principalId: 'EXAMPLE' },
            requestParameters: { sourceIPAddress: '127.0.0.1' },
            responseElements: {
              'x-amz-request-id': 'REQ2',
              'x-amz-id-2': 'ID2',
            },
            s3: {
              s3SchemaVersion: '1.0',
              configurationId: 'testConfigRule',
              bucket: {
                name: 'test-bucket',
                ownerIdentity: { principalId: 'EXAMPLE' },
                arn: 'arn:aws:s3:::test-bucket',
              },
              object: {
                key: 'media/id-2/file2.wav',
                size: 200,
                eTag: 'etag2',
                sequencer: 'seq2',
              },
            },
          },
        ],
      };

      await handler(event);

      expect(mockSend).toHaveBeenCalledTimes(2);

      const firstCall = mockSend.mock.calls[0][0].input;
      expect(firstCall.Item.mediaFileId).toBe('id-1');
      expect(firstCall.Item.filename).toBe('file1.mp3');

      const secondCall = mockSend.mock.calls[1][0].input;
      expect(secondCall.Item.mediaFileId).toBe('id-2');
      expect(secondCall.Item.filename).toBe('file2.wav');
    });
  });
});
