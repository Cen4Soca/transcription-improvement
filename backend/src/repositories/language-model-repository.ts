/**
 * Language Model Repository
 *
 * DynamoDB data access layer for custom language model metadata.
 *
 * The Transcribe model itself is an immutable, account-global resource; this
 * repository stores the app-side metadata (team ownership, display name, etc.)
 * as a separate single-table record.
 *
 * Key design:
 *   PK:     LANGUAGEMODEL#{modelName}
 *   SK:     METADATA
 *   GSI1PK: TEAM#{teamId}                   (ride-on; team-scoped list)
 *   GSI1SK: LANGUAGEMODEL#{modelName}        (distinct prefix, invisible to MEDIA#/SESSION# queries)
 *   GSI2PK: TEAM#{teamId}#DISPLAYNAME        (ride-on; within-team displayName uniqueness)
 *   GSI2SK: {displayNameLower}
 *   GSI3PK: 'LANGUAGEMODEL'                  (fixed partition; ADMIN full list)
 *   GSI3SK: {modelName}
 */

import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import type { LanguageModelMetadata } from '../types/index.js';

const GSI3_PARTITION = 'LANGUAGEMODEL';
const LANGUAGE_MODEL_GSI1_PREFIX = 'LANGUAGEMODEL#';

const KEYS = {
  pk: (modelName: string): string => `LANGUAGEMODEL#${modelName}`,
  sk: 'METADATA',
  gsi1pk: (teamId: string): string => `TEAM#${teamId}`,
  gsi1sk: (modelName: string): string => `LANGUAGEMODEL#${modelName}`,
  gsi2pk: (teamId: string): string => `TEAM#${teamId}#DISPLAYNAME`,
};

/**
 * Build the full DynamoDB item (including index keys) for a metadata record.
 */
function toItem(model: LanguageModelMetadata): Record<string, unknown> {
  return {
    PK: KEYS.pk(model.modelName),
    SK: KEYS.sk,
    GSI1PK: KEYS.gsi1pk(model.teamId),
    GSI1SK: KEYS.gsi1sk(model.modelName),
    GSI2PK: KEYS.gsi2pk(model.teamId),
    GSI2SK: model.displayNameLower,
    GSI3PK: GSI3_PARTITION,
    GSI3SK: model.modelName,
    entityType: 'LanguageModel',
    modelName: model.modelName,
    teamId: model.teamId,
    displayName: model.displayName,
    displayNameLower: model.displayNameLower,
    baseModelName: model.baseModelName,
    createdBy: model.createdBy,
    createdAt: model.createdAt,
    sessionIds: model.sessionIds,
    s3Key: model.s3Key,
    deletionStatus: model.deletionStatus,
  };
}

/**
 * Map a DynamoDB item to a LanguageModelMetadata record.
 */
function mapItem(item: Record<string, unknown>): LanguageModelMetadata {
  return {
    modelName: item['modelName'] as string,
    teamId: item['teamId'] as string,
    displayName: item['displayName'] as string,
    displayNameLower: item['displayNameLower'] as string,
    baseModelName: item['baseModelName'] as string,
    createdBy: item['createdBy'] as string,
    createdAt: item['createdAt'] as string,
    sessionIds: (item['sessionIds'] as string[]) ?? [],
    s3Key: item['s3Key'] as string,
    deletionStatus: item['deletionStatus'] as LanguageModelMetadata['deletionStatus'],
  };
}

/**
 * Create or overwrite a language model metadata record.
 */
export async function putModel(model: LanguageModelMetadata): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: toItem(model),
    })
  );
}

/**
 * Get a single language model metadata record by model name.
 */
export async function getModel(
  modelName: string
): Promise<LanguageModelMetadata | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: KEYS.pk(modelName),
        SK: KEYS.sk,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return mapItem(result.Item);
}

/**
 * List all language models owned by a team using GSI1.
 * Scoped with a begins_with on the LANGUAGEMODEL# sort-key prefix so results
 * cannot collide with MEDIA#/SESSION# items that share the TEAM# partition.
 */
export async function queryByTeam(
  teamId: string
): Promise<LanguageModelMetadata[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': KEYS.gsi1pk(teamId),
        ':prefix': LANGUAGE_MODEL_GSI1_PREFIX,
      },
    })
  );

  return (result.Items ?? []).map(mapItem);
}

/**
 * List all language models across all teams using GSI3 (ADMIN only).
 */
export async function queryAll(): Promise<LanguageModelMetadata[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: {
        ':pk': GSI3_PARTITION,
      },
    })
  );

  return (result.Items ?? []).map(mapItem);
}

/**
 * Find a model in a team by its (lower-cased) display name using GSI2.
 * Used to enforce within-team displayName uniqueness.
 */
export async function findByDisplayName(
  teamId: string,
  displayNameLower: string
): Promise<LanguageModelMetadata | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :sk',
      ExpressionAttributeValues: {
        ':pk': KEYS.gsi2pk(teamId),
        ':sk': displayNameLower,
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return mapItem(result.Items[0]);
}

/**
 * Re-assign a model to a different team.
 * Rewrites the teamId attribute and the dependent GSI1PK/GSI2PK keys.
 */
export async function updateTeamId(
  modelName: string,
  teamId: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: KEYS.pk(modelName),
        SK: KEYS.sk,
      },
      UpdateExpression:
        'SET teamId = :teamId, GSI1PK = :gsi1pk, GSI2PK = :gsi2pk',
      ExpressionAttributeValues: {
        ':teamId': teamId,
        ':gsi1pk': KEYS.gsi1pk(teamId),
        ':gsi2pk': KEYS.gsi2pk(teamId),
      },
    })
  );
}

/**
 * Update the display name of a model.
 * Rewrites displayName/displayNameLower and the dependent GSI2SK key.
 */
export async function updateDisplayName(
  modelName: string,
  displayName: string,
  displayNameLower: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: KEYS.pk(modelName),
        SK: KEYS.sk,
      },
      UpdateExpression:
        'SET displayName = :displayName, displayNameLower = :displayNameLower, GSI2SK = :gsi2sk',
      ExpressionAttributeValues: {
        ':displayName': displayName,
        ':displayNameLower': displayNameLower,
        ':gsi2sk': displayNameLower,
      },
    })
  );
}

/**
 * Set the deletion status of a model (soft delete / restore).
 */
export async function setDeletionStatus(
  modelName: string,
  deletionStatus: LanguageModelMetadata['deletionStatus']
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: KEYS.pk(modelName),
        SK: KEYS.sk,
      },
      UpdateExpression: 'SET deletionStatus = :deletionStatus',
      ExpressionAttributeValues: {
        ':deletionStatus': deletionStatus,
      },
    })
  );
}

/**
 * Permanently remove the metadata record for a model.
 */
export async function hardDelete(modelName: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: KEYS.pk(modelName),
        SK: KEYS.sk,
      },
    })
  );
}
