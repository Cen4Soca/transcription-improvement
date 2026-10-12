import type { S3Event } from 'aws-lambda';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import {
  MEDIA_FILE_KEYS,
  MEDIA_FILE_ENTITY_TYPE,
} from '../types/media-file.js';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const EVENT_SOURCE = 'transcription-review-app';

const eventBridgeClient = new EventBridgeClient({ region: REGION });

/**
 * Publish the `S3ObjectCreated` event that triggers the malware scan Lambda.
 * Kept separate so a failure here is logged without losing the metadata write.
 */
async function publishScanEvent(bucketName: string, s3Key: string): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: EVENT_SOURCE,
          DetailType: 'S3ObjectCreated',
          Detail: JSON.stringify({ bucketName, s3Key }),
        },
      ],
    })
  );
}

// --- Interfaces ---

export interface ExtractedMetadata {
  mediaFileId: string;
  filename: string;
  s3Key: string;
  contentType: string;
  fileSize: number;
  bucketName: string;
}

// --- Content type mapping ---

const EXTENSION_CONTENT_TYPE_MAP: Record<string, string> = {
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

// --- Pure Functions ---

/**
 * Infer content type from file extension.
 * Falls back to 'application/octet-stream' if extension is unknown.
 */
export function inferContentType(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return 'application/octet-stream';
  }
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return EXTENSION_CONTENT_TYPE_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Extract metadata from an S3 ObjectCreated event record.
 * Parses the S3 key pattern: media/{mediaFileId}/{filename}
 *
 * Pure function — exported for property testing.
 */
export function extractMetadata(event: S3Event): ExtractedMetadata[] {
  return event.Records.map((record) => {
    const bucketName = record.s3.bucket.name;
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const fileSize = record.s3.object.size;

    // Parse key pattern: media/{mediaFileId}/{filename}
    const parts = s3Key.split('/');
    const mediaFileId = parts[1] ?? '';
    const filename = parts.slice(2).join('/');

    const contentType = inferContentType(filename);

    return {
      mediaFileId,
      filename,
      s3Key,
      contentType,
      fileSize,
      bucketName,
    };
  });
}

// --- Handler ---

/**
 * process-upload Lambda handler.
 * Triggered by S3 Event Notification (ObjectCreated) on the media bucket.
 *
 * - Extracts metadata from the S3 event
 * - Saves a MediaFile record to DynamoDB with status 'UPLOADED' and scanStatus 'PENDING'
 * - Uses ConditionExpression for idempotency (won't overwrite existing records)
 */
export async function handler(event: S3Event): Promise<void> {
  const metadataList = extractMetadata(event);

  for (const metadata of metadataList) {
    const now = new Date().toISOString();

    const item: Record<string, unknown> = {
      PK: MEDIA_FILE_KEYS.pk(metadata.mediaFileId),
      SK: MEDIA_FILE_KEYS.sk,
      entityType: MEDIA_FILE_ENTITY_TYPE,
      mediaFileId: metadata.mediaFileId,
      filename: metadata.filename,
      s3Key: metadata.s3Key,
      s3Bucket: metadata.bucketName,
      contentType: metadata.contentType,
      fileSize: metadata.fileSize,
      uploadedBy: 'system',
      uploadedAt: now,
      scanStatus: 'PENDING',
      status: 'UPLOADED',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );
      console.log(`MediaFile record saved: ${metadata.mediaFileId}`);
    } catch (error: unknown) {
      // ConditionalCheckFailedException means the item already exists.
      // This happens when the record was pre-created at presigned-URL issue time
      // (which carries the real uploadedBy). In that case, just advance the status
      // to UPLOADED without overwriting uploadedBy or other metadata.
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        console.log(
          `MediaFile record already exists; updating status to UPLOADED: ${metadata.mediaFileId}`
        );
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              PK: MEDIA_FILE_KEYS.pk(metadata.mediaFileId),
              SK: MEDIA_FILE_KEYS.sk,
            },
            UpdateExpression: 'SET #status = :status, updatedAt = :now',
            // Only advance from the pre-upload state; never move a COMPLETED/PROCESSING
            // record backwards.
            ConditionExpression:
              'attribute_not_exists(#status) OR #status = :uploading',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':status': 'UPLOADED',
              ':uploading': 'UPLOADING',
              ':now': now,
            },
          })
        ).catch((updErr: unknown) => {
          // If the status is no longer UPLOADING (e.g. already advanced), ignore.
          if (
            updErr instanceof Error &&
            updErr.name === 'ConditionalCheckFailedException'
          ) {
            console.log(
              `MediaFile status already advanced (idempotent skip): ${metadata.mediaFileId}`
            );
          } else {
            throw updErr;
          }
        });
      } else {
        console.error(
          `Failed to save MediaFile record: ${metadata.mediaFileId}`,
          error
        );
        throw error;
      }
    }

    // Metadata is persisted; kick off the malware scan via a custom EventBridge
    // event. A publish failure must not fail the metadata write (which would
    // trigger DLQ re-processing), so it is logged and swallowed here.
    try {
      await publishScanEvent(metadata.bucketName, metadata.s3Key);
      console.log(`Published S3ObjectCreated scan event: ${metadata.mediaFileId}`);
    } catch (evtErr: unknown) {
      console.error(
        `Failed to publish scan event for ${metadata.mediaFileId}:`,
        evtErr
      );
    }
  }
}
