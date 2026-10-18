import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import {
  TranscriptionJob,
  TranscriptionJobStatus,
  TRANSCRIPTION_JOB_KEYS,
  TRANSCRIPTION_JOB_ENTITY_TYPE,
} from '../types/transcription-job.js';

/**
 * Save a new TranscriptionJob record to DynamoDB.
 */
export async function save(record: TranscriptionJob): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: TRANSCRIPTION_JOB_KEYS.pk(record.jobId),
        SK: TRANSCRIPTION_JOB_KEYS.sk,
        GSI1PK: TRANSCRIPTION_JOB_KEYS.gsi1pk(record.mediaFileId),
        GSI1SK: TRANSCRIPTION_JOB_KEYS.gsi1sk(record.createdAt, record.jobId),
        GSI2PK: TRANSCRIPTION_JOB_KEYS.gsi2pk(record.transcribeJobName),
        GSI2SK: TRANSCRIPTION_JOB_KEYS.gsi2sk(record.createdAt),
        entityType: TRANSCRIPTION_JOB_ENTITY_TYPE,
        jobId: record.jobId,
        transcribeJobName: record.transcribeJobName,
        mediaFileId: record.mediaFileId,
        status: record.status,
        languageCode: record.languageCode,
        maxSpeakerLabels: record.maxSpeakerLabels,
        languageModelName: record.languageModelName,
        outputS3Key: record.outputS3Key,
        sessionId: record.sessionId,
        failureReason: record.failureReason,
        startedBy: record.startedBy,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    })
  );
}

/**
 * Get a TranscriptionJob by its jobId.
 */
export async function getById(jobId: string): Promise<TranscriptionJob | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: TRANSCRIPTION_JOB_KEYS.pk(jobId),
        SK: TRANSCRIPTION_JOB_KEYS.sk,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return mapItemToTranscriptionJob(result.Item);
}

/**
 * Get a TranscriptionJob by its Amazon Transcribe job name.
 * Queries GSI2 with TRANSCRIBE#{transcribeJobName}.
 */
export async function getByTranscribeJobName(
  transcribeJobName: string
): Promise<TranscriptionJob | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi2pk': TRANSCRIPTION_JOB_KEYS.gsi2pk(transcribeJobName),
        ':prefix': 'JOB#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return mapItemToTranscriptionJob(result.Items[0]);
}

/**
 * Update the status of a TranscriptionJob.
 * Optionally sets failureReason when status is FAILED.
 */
export async function updateStatus(
  jobId: string,
  status: TranscriptionJobStatus,
  failureReason?: string
): Promise<void> {
  const now = new Date().toISOString();

  const expressionParts = ['#status = :status', 'updatedAt = :updatedAt'];
  const expressionValues: Record<string, unknown> = {
    ':status': status,
    ':updatedAt': now,
  };

  if (failureReason !== undefined) {
    expressionParts.push('failureReason = :failureReason');
    expressionValues[':failureReason'] = failureReason;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: TRANSCRIPTION_JOB_KEYS.pk(jobId),
        SK: TRANSCRIPTION_JOB_KEYS.sk,
      },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: expressionValues,
    })
  );
}

/**
 * List all TranscriptionJobs for a given media file.
 * Uses GSI1 with GSI1PK=MEDIA#{mediaFileId} and GSI1SK begins_with JOB#.
 * Returns every job ever created for the media file (including superseded ones).
 */
export async function listByMediaFileId(
  mediaFileId: string
): Promise<TranscriptionJob[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': TRANSCRIPTION_JOB_KEYS.gsi1pk(mediaFileId),
        ':prefix': 'JOB#',
      },
    })
  );

  return (result.Items ?? []).map(mapItemToTranscriptionJob);
}

/**
 * Delete a TranscriptionJob record by its jobId.
 */
export async function deleteById(jobId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: TRANSCRIPTION_JOB_KEYS.pk(jobId),
        SK: TRANSCRIPTION_JOB_KEYS.sk,
      },
    })
  );
}

/**
 * Map a DynamoDB item to a TranscriptionJob entity.
 */
function mapItemToTranscriptionJob(
  item: Record<string, unknown>
): TranscriptionJob {
  return {
    jobId: item['jobId'] as string,
    transcribeJobName: item['transcribeJobName'] as string,
    mediaFileId: item['mediaFileId'] as string,
    status: item['status'] as TranscriptionJobStatus,
    languageCode: item['languageCode'] as string,
    maxSpeakerLabels: item['maxSpeakerLabels'] as number,
    languageModelName: item['languageModelName'] as string | undefined,
    outputS3Key: item['outputS3Key'] as string | undefined,
    sessionId: item['sessionId'] as string | undefined,
    failureReason: item['failureReason'] as string | undefined,
    startedBy: item['startedBy'] as string,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };
}
