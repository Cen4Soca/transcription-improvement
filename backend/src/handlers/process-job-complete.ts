import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';

// --- Interfaces ---

export interface TranscribeJobEvent {
  source: 'aws.transcribe';
  'detail-type': 'Transcribe Job State Change';
  detail: {
    TranscriptionJobName: string;
    TranscriptionJobStatus: 'COMPLETED' | 'FAILED';
    FailureReason?: string;
  };
}

export interface TranscribeOutput {
  results: {
    transcripts: Array<{ transcript: string }>;
    speaker_labels: {
      speakers: number;
      segments: Array<{
        start_time: string;
        end_time: string;
        speaker_label: string;
        items: Array<{
          start_time: string;
          end_time: string;
          speaker_label: string;
        }>;
      }>;
    };
    items: Array<{
      start_time?: string;
      end_time?: string;
      type: 'pronunciation' | 'punctuation';
      alternatives: Array<{ confidence: string; content: string }>;
    }>;
  };
}

export interface Segment {
  segmentId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel: string;
}

// --- S3 Client (lazy singleton) ---

let s3Client: S3Client | undefined;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

/** Allow overriding the S3 client for testing */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

// --- Environment helpers ---

function getDataBucketName(): string {
  return process.env.DATA_BUCKET_NAME ?? '';
}

/**
 * Format startTime as a zero-padded string for DynamoDB sort key ordering.
 * e.g., 1.5 → "00001.500", 123.456 → "00123.456"
 * Ensures lexicographic ordering matches numeric ordering.
 * Exported for testing.
 */
export function formatStartTimeForSK(startTime: number): string {
  const intPart = Math.floor(startTime);
  const fracPart = Math.round((startTime - intPart) * 1000);
  return `${intPart.toString().padStart(5, '0')}.${fracPart.toString().padStart(3, '0')}`;
}

// --- Pure Functions ---

/**
 * Determine whether the transcription language is space-delimited.
 * Japanese (and other CJK languages) do not separate words with spaces, so
 * joining Transcribe's word-level items with spaces produces incorrect text
 * (e.g. "今日 は 良い 天気"). For those languages we concatenate without spaces.
 *
 * Defaults to space-delimited (English-like) when the language code is unknown.
 * Exported for testing.
 */
export function isSpaceDelimitedLanguage(languageCode?: string): boolean {
  if (!languageCode) {
    return true;
  }
  const lang = languageCode.toLowerCase();
  // Languages that do not use spaces between words.
  const nonSpaceDelimitedPrefixes = ['ja', 'zh', 'yue', 'th', 'lo', 'km', 'my'];
  return !nonSpaceDelimitedPrefixes.some(
    (prefix) => lang === prefix || lang.startsWith(`${prefix}-`)
  );
}

// Matches a single CJK / Japanese / kana character. Used to keep ASCII words
// (e.g. embedded English or numbers) space-separated even inside a non
// space-delimited language.
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

/**
 * Decide whether a space should be inserted between two adjacent pronunciation
 * tokens for a non space-delimited language. A space is only kept when both the
 * preceding and following characters are non-CJK (e.g. "AWS SDK" stays
 * separated), so purely Japanese text is joined tightly.
 */
function needsSpaceBetween(prevChar: string, nextChar: string): boolean {
  if (prevChar === '' || nextChar === '') {
    return false;
  }
  return !CJK_CHAR.test(prevChar) && !CJK_CHAR.test(nextChar);
}

/**
 * Parse Amazon Transcribe output JSON into Segment data.
 *
 * Logic:
 * 1. Get speaker_labels.segments for speaker boundaries (start_time, end_time, speaker_label)
 * 2. Get items for word timestamps and text
 * 3. For each speaker segment, collect items whose start_time falls within the segment's time range
 * 4. Concatenate item text: space between pronunciations, no space before punctuation.
 *    For non space-delimited languages (e.g. Japanese) pronunciations are joined
 *    without spaces, except where both sides are non-CJK (embedded ASCII words).
 * 5. Each output Segment: { segmentId, startTime, endTime, originalText, speakerLabel }
 *
 * Exported as a pure function for property-based testing.
 */
export function parseTranscribeOutput(
  output: TranscribeOutput,
  languageCode?: string
): Omit<Segment, 'segmentId'>[] {
  const spaceDelimited = isSpaceDelimitedLanguage(languageCode);
  const speakerSegments = output.results.speaker_labels.segments;
  const items = output.results.items;

  const segments: Omit<Segment, 'segmentId'>[] = [];

  for (const speakerSegment of speakerSegments) {
    const segStartTime = parseFloat(speakerSegment.start_time);
    const segEndTime = parseFloat(speakerSegment.end_time);
    const speakerLabel = speakerSegment.speaker_label;

    // Collect pronunciation items in this segment, attaching trailing punctuation items
    const segmentItemsWithPunctuation: typeof items = [];
    let i = 0;
    while (i < items.length) {
      const item = items[i];
      if (item.start_time !== undefined) {
        const itemStartTime = parseFloat(item.start_time);
        if (itemStartTime >= segStartTime && itemStartTime <= segEndTime) {
          segmentItemsWithPunctuation.push(item);
          // Collect trailing punctuation items
          let j = i + 1;
          while (j < items.length && items[j].type === 'punctuation' && items[j].start_time === undefined) {
            segmentItemsWithPunctuation.push(items[j]);
            j++;
          }
          i = j;
          continue;
        }
      }
      i++;
    }

    // Concatenate text: space between pronunciations, no space before punctuation.
    // For non space-delimited languages, join without spaces unless both sides
    // are non-CJK (keeps embedded ASCII words like "AWS SDK" readable).
    let text = '';
    for (const item of segmentItemsWithPunctuation) {
      const content = item.alternatives[0]?.content ?? '';
      if (item.type === 'punctuation') {
        text += content;
      } else {
        if (text.length > 0) {
          const insertSpace = spaceDelimited
            ? true
            : needsSpaceBetween(text[text.length - 1], content[0] ?? '');
          if (insertSpace) {
            text += ' ';
          }
        }
        text += content;
      }
    }

    if (text.length > 0) {
      segments.push({
        startTime: segStartTime,
        endTime: segEndTime,
        originalText: text,
        speakerLabel,
      });
    }
  }

  return segments;
}

// --- Handler ---

/**
 * process-job-complete Lambda handler.
 * Triggered by EventBridge rule for Transcribe Job State Change events.
 *
 * Flow:
 * 1. Extract TranscriptionJobName and status from EventBridge event detail
 * 2. Look up TranscriptionJob by transcribeJobName
 * 3. Idempotency: if job.status !== 'IN_PROGRESS', log and return early
 * 4. If event status is 'FAILED': update status to FAILED, return
 * 5. If event status is 'COMPLETED':
 *    - Fetch output JSON from S3
 *    - Parse with parseTranscribeOutput()
 *    - Save Segments to DynamoDB
 *    - Create ReviewSession record (status=PENDING)
 *    - Update TranscriptionJob status to COMPLETED, set sessionId
 */
export async function handler(event: TranscribeJobEvent): Promise<void> {
  const { TranscriptionJobName, TranscriptionJobStatus, FailureReason } = event.detail;

  console.log(`Processing Transcribe job completion: ${TranscriptionJobName}, status: ${TranscriptionJobStatus}`);

  // Look up TranscriptionJob by transcribeJobName
  const job = await transcriptionJobRepository.getByTranscribeJobName(TranscriptionJobName);
  if (!job) {
    console.error(`TranscriptionJob not found for transcribeJobName: ${TranscriptionJobName}`);
    return;
  }

  // Idempotency: only process if status is IN_PROGRESS
  if (job.status !== 'IN_PROGRESS') {
    console.log(`Job ${job.jobId} already processed (status: ${job.status}). Skipping.`);
    return;
  }

  // Handle FAILED status
  if (TranscriptionJobStatus === 'FAILED') {
    await transcriptionJobRepository.updateStatus(job.jobId, 'FAILED', FailureReason);

    // Reflect the failure on the media file so the media list shows "失敗"
    // instead of remaining stuck at "処理中". Non-fatal: the job is already
    // marked FAILED above.
    try {
      await mediaFileRepository.updateStatus(job.mediaFileId, 'FAILED');
    } catch (error: unknown) {
      console.error(`Failed to update media file status to FAILED: ${job.mediaFileId}`, error);
    }

    console.log(`Job ${job.jobId} marked as FAILED. Reason: ${FailureReason}`);
    return;
  }

  // Handle COMPLETED status
  const dataBucket = getDataBucketName();
  if (!dataBucket) {
    console.error('DATA_BUCKET_NAME environment variable is not set');
    throw new Error('DATA_BUCKET_NAME environment variable is not set');
  }

  if (!job.outputS3Key) {
    console.error(`Job ${job.jobId} has no outputS3Key`);
    throw new Error(`Job ${job.jobId} has no outputS3Key`);
  }

  // Fetch Transcribe output JSON from S3
  const s3Response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: dataBucket,
      Key: job.outputS3Key,
    })
  );

  const outputBody = await s3Response.Body?.transformToString();
  if (!outputBody) {
    console.error(`Empty S3 object for key: ${job.outputS3Key}`);
    throw new Error(`Empty S3 object for key: ${job.outputS3Key}`);
  }

  const transcribeOutput: TranscribeOutput = JSON.parse(outputBody);

  // Parse Transcribe output into segments. The job's languageCode controls
  // whether word-level items are joined with spaces (English) or without
  // spaces (Japanese and other CJK languages).
  const parsedSegments = parseTranscribeOutput(transcribeOutput, job.languageCode);

  // Reuse the ReviewSession that startJob() already created and linked to the
  // media file (job.sessionId). Minting a new sessionId here would create a
  // duplicate, empty session and detach the segments from the media-linked
  // session. Fall back to a new sessionId only if startJob() failed to create
  // one (Req 17.8: the job result must still be preserved).
  const sessionId = job.sessionId ?? crypto.randomUUID();
  const sessionAlreadyCreated = Boolean(job.sessionId);

  // Save Segments to DynamoDB
  for (const segment of parsedSegments) {
    const segmentId = crypto.randomUUID();
    const startTimePadded = formatStartTimeForSK(segment.startTime);

    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `SESSION#${sessionId}`,
            SK: `SEGMENT#${startTimePadded}#${segmentId}`,
            entityType: 'Segment',
            segmentId,
            sessionId,
            startTime: segment.startTime,
            endTime: segment.endTime,
            originalText: segment.originalText,
            speakerLabel: segment.speakerLabel,
            consensusStatus: 'UNDECIDED',
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        })
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        console.log(`Segment ${segmentId} already exists (idempotent skip)`);
      } else {
        throw error;
      }
    }
  }

  const now = new Date().toISOString();

  // Create the ReviewSession record only when startJob() did NOT already create
  // one. In the normal flow the session exists (created + media-linked at job
  // start), so we skip this to avoid a duplicate, empty session. The fallback
  // covers the rare case where startJob() failed to create a session.
  if (!sessionAlreadyCreated) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `SESSION#${sessionId}`,
            SK: 'METADATA',
            entityType: 'ReviewSession',
            sessionId,
            transcriptionJobId: job.jobId,
            name: job.transcribeJobName,
            status: 'PENDING',
            assignedReviewerCount: 0,
            consensusThreshold: 67,
            mediaFileId: job.mediaFileId,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        })
      );
      console.log(`ReviewSession created (fallback): ${sessionId}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        console.log(`ReviewSession ${sessionId} already exists (idempotent skip)`);
      } else {
        // Log but don't fail the entire process - the segments are already saved
        console.error(`Failed to create ReviewSession: ${sessionId}`, error);
      }
    }
  } else {
    console.log(`Reusing ReviewSession created at job start: ${sessionId}`);
  }

  // Update TranscriptionJob status to COMPLETED and set sessionId
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `JOB#${job.jobId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET #status = :status, sessionId = :sessionId, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'COMPLETED',
        ':sessionId': sessionId,
        ':updatedAt': now,
      },
    })
  );

  // Advance the media file to COMPLETED so the media list reflects that the
  // transcription has finished (previously it stayed at UPLOADED forever).
  // Non-fatal: the job result is already persisted above.
  try {
    await mediaFileRepository.updateStatus(job.mediaFileId, 'COMPLETED');
  } catch (error: unknown) {
    console.error(`Failed to update media file status to COMPLETED: ${job.mediaFileId}`, error);
  }

  console.log(`Job ${job.jobId} marked as COMPLETED. SessionId: ${sessionId}`);
}
