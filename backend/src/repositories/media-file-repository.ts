import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import {
  MediaFile,
  MediaFileStatus,
  MEDIA_FILE_KEYS,
  MEDIA_FILE_ENTITY_TYPE,
} from '../types/media-file.js';

/**
 * Save a new MediaFile record to DynamoDB.
 */
export async function save(record: MediaFile): Promise<void> {
  const item: Record<string, unknown> = {
    PK: MEDIA_FILE_KEYS.pk(record.mediaFileId),
    SK: MEDIA_FILE_KEYS.sk,
    entityType: MEDIA_FILE_ENTITY_TYPE,
    mediaFileId: record.mediaFileId,
    filename: record.filename,
    s3Key: record.s3Key,
    contentType: record.contentType,
    fileSize: record.fileSize,
    uploadedBy: record.uploadedBy,
    teamId: record.teamId,
    status: record.status,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };

  // Set GSI keys for team-based and user-based querying
  if (record.teamId) {
    item['GSI1PK'] = MEDIA_FILE_KEYS.gsi1pk(record.teamId);
    item['GSI1SK'] = MEDIA_FILE_KEYS.gsi1sk(record.createdAt, record.mediaFileId);
  }

  item['GSI2PK'] = MEDIA_FILE_KEYS.gsi2pk(record.uploadedBy);
  item['GSI2SK'] = MEDIA_FILE_KEYS.gsi2sk(record.createdAt, record.mediaFileId);

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );
}

/**
 * Get a MediaFile by its mediaFileId.
 */
export async function getById(mediaFileId: string): Promise<MediaFile | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: MEDIA_FILE_KEYS.pk(mediaFileId),
        SK: MEDIA_FILE_KEYS.sk,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return mapItemToMediaFile(result.Item);
}

/**
 * Get a MediaFile by its associated sessionId.
 * Note: sessionId is not a key attribute, so this uses a Scan with FilterExpression.
 * For high-volume usage, consider adding a GSI on sessionId.
 */
export async function getBySessionId(sessionId: string): Promise<MediaFile | null> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityType = :entityType AND sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':entityType': MEDIA_FILE_ENTITY_TYPE,
        ':sessionId': sessionId,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return mapItemToMediaFile(result.Items[0]);
}

/**
 * Update the sessionId associated with a MediaFile.
 * Used when a (re-)transcription creates a new ReviewSession for the media file,
 * so that the media file points at its current session.
 */
export async function updateSessionId(
  mediaFileId: string,
  sessionId: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: MEDIA_FILE_KEYS.pk(mediaFileId),
        SK: MEDIA_FILE_KEYS.sk,
      },
      UpdateExpression: 'SET sessionId = :sessionId, updatedAt = :now',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
        ':now': new Date().toISOString(),
      },
    })
  );
}

/**
 * Update the processing status of a MediaFile.
 * Used to reflect transcription progress on the media file:
 * - PROCESSING when a transcription job starts.
 * - COMPLETED when the transcription job finishes successfully.
 */
export async function updateStatus(
  mediaFileId: string,
  status: MediaFileStatus
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: MEDIA_FILE_KEYS.pk(mediaFileId),
        SK: MEDIA_FILE_KEYS.sk,
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':now': new Date().toISOString(),
      },
    })
  );
}

/**
 * Delete a MediaFile record by its mediaFileId.
 */
export async function deleteById(mediaFileId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: MEDIA_FILE_KEYS.pk(mediaFileId),
        SK: MEDIA_FILE_KEYS.sk,
      },
    })
  );
}

/**
 * List all MediaFiles uploaded by a specific user, sorted by createdAt descending.
 * Uses GSI2 with GSI2PK=USER#{uploadedBy} and GSI2SK begins_with MEDIA#.
 */
export async function listByUploader(uploadedBy: string): Promise<MediaFile[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi2pk': MEDIA_FILE_KEYS.gsi2pk(uploadedBy),
        ':prefix': 'MEDIA#',
      },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []).map(mapItemToMediaFile);
}

/**
 * List all MediaFiles (for ADMIN), paginating through all Scan pages.
 */
export async function listAll(): Promise<MediaFile[]> {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'entityType = :entityType AND SK = :sk',
        ExpressionAttributeValues: {
          ':entityType': MEDIA_FILE_ENTITY_TYPE,
          ':sk': MEDIA_FILE_KEYS.sk,
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      })
    );

    items.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return items.map(mapItemToMediaFile);
}

/**
 * List all MediaFiles for a specific team, sorted by createdAt descending.
 * Uses GSI1 with GSI1PK=TEAM#{teamId} and GSI1SK begins_with MEDIA#.
 */
export async function listByTeam(teamId: string): Promise<MediaFile[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': MEDIA_FILE_KEYS.gsi1pk(teamId),
        ':prefix': 'MEDIA#',
      },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []).map(mapItemToMediaFile);
}

/**
 * Map a DynamoDB item to a MediaFile entity.
 */
function mapItemToMediaFile(item: Record<string, unknown>): MediaFile {
  return {
    mediaFileId: item['mediaFileId'] as string,
    filename: item['filename'] as string,
    s3Key: item['s3Key'] as string,
    contentType: item['contentType'] as string,
    fileSize: item['fileSize'] as number,
    uploadedBy: item['uploadedBy'] as string,
    teamId: item['teamId'] as string | undefined,
    status: item['status'] as MediaFile['status'],
    scanStatus: item['scanStatus'] as MediaFile['scanStatus'],
    sessionId: item['sessionId'] as string | undefined,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };
}
