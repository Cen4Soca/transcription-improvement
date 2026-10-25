import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * DynamoDB helpers for provisioning the reusable fixed E2E users directly,
 * mirroring the backend user-repository single-table layout:
 *   PK: USER#{userId}, SK: METADATA
 *   GSI1PK: EMAIL#{email}, GSI1SK: USER#{userId}
 *   entityType: 'User', userId, email, displayName, role, isActive
 *
 * Writing the record directly (no API, no Cognito email) keeps `extractUser`'s
 * email-based resolution consistent and role correct, without consuming the
 * Cognito email quota.
 */

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'TranscriptionReviewApp';
const REGION = process.env.AWS_REGION || 'ap-northeast-1';

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

/** Look up a user record by email via GSI1. Returns its userId, or null. */
export async function getUserIdByEmail(email: string): Promise<string | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `EMAIL#${email}`,
        ':prefix': 'USER#',
      },
      Limit: 1,
    })
  );
  const item = res.Items?.[0] as { userId?: string } | undefined;
  return item?.userId ?? null;
}

/**
 * Ensure a DynamoDB user record exists for the given email. If one already
 * exists, its userId is returned unchanged. Otherwise a new record is written
 * with the given userId/role (isActive: true).
 */
export async function ensureUserRecord(params: {
  userId: string;
  email: string;
  displayName: string;
  role: 'TEAM_LEADER' | 'REVIEWER' | 'ADMIN';
}): Promise<string> {
  const existing = await getUserIdByEmail(params.email);
  if (existing) return existing;

  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${params.userId}`,
        SK: 'METADATA',
        GSI1PK: `EMAIL#${params.email}`,
        GSI1SK: `USER#${params.userId}`,
        entityType: 'User',
        userId: params.userId,
        email: params.email,
        displayName: params.displayName,
        role: params.role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );
  return params.userId;
}
