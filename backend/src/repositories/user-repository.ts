import {
  QueryCommand,
  PutCommand,
  UpdateCommand,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

export interface UserRecord {
  userId: string;
  email: string;
  displayName: string;
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  userId: string;
  email: string;
  displayName: string;
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
}

export interface UpdateUserInput {
  role?: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  isActive?: boolean;
  displayName?: string;
  email?: string;
}

/**
 * Get all users from DynamoDB.
 * Scans the table filtering by entityType=User, paginating through all pages
 * so that users are not silently dropped once the table exceeds one Scan page (~1MB).
 */
export async function getAllUsers(): Promise<UserRecord[]> {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'entityType = :entityType AND SK = :sk',
        ExpressionAttributeValues: {
          ':entityType': 'User',
          ':sk': 'METADATA',
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      })
    );

    items.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items.map(mapItemToUserRecord);
}

/**
 * Find users whose displayName matches the given name (case-insensitive,
 * substring match).
 *
 * displayName is not unique and is not indexed, so this scans the User
 * partition (same access pattern as getAllUsers) and filters in memory.
 * Returns every matching user so that callers can, for example, aggregate
 * audit logs for all actors sharing a name.
 */
export async function findUsersByDisplayName(
  displayName: string
): Promise<UserRecord[]> {
  const needle = displayName.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }

  const allUsers = await getAllUsers();
  return allUsers.filter((u) => u.displayName.toLowerCase().includes(needle));
}

/**
 * Get a user by userId.
 * PK: USER#{userId}, SK: METADATA
 */
export async function getUserById(userId: string): Promise<UserRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'METADATA',
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return mapItemToUserRecord(result.Item);
}

/**
 * Get a user by email using GSI1.
 * GSI1PK: EMAIL#{email}, GSI1SK: USER#{userId}
 */
export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `EMAIL#${email}`,
        ':prefix': 'USER#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return mapItemToUserRecord(result.Items[0]);
}

/**
 * Create a new user in DynamoDB.
 * PK: USER#{userId}, SK: METADATA
 * GSI1PK: EMAIL#{email}, GSI1SK: USER#{userId}
 */
export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const now = new Date().toISOString();

  const item: Record<string, unknown> = {
    PK: `USER#${input.userId}`,
    SK: 'METADATA',
    GSI1PK: `EMAIL#${input.email}`,
    GSI1SK: `USER#${input.userId}`,
    entityType: 'User',
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );

  return {
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a user's role, active status, display name and/or email.
 *
 * NOTE: Updating email also rewrites GSI1PK (EMAIL#{email}) so that the
 * email lookup index stays consistent. Callers are responsible for ensuring
 * the new email is unique before invoking this function.
 */
export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<UserRecord> {
  const now = new Date().toISOString();

  const updateExpressions: string[] = ['updatedAt = :updatedAt'];
  const expressionAttributeValues: Record<string, unknown> = {
    ':updatedAt': now,
  };
  const expressionAttributeNames: Record<string, string> = {};

  if (input.role !== undefined) {
    updateExpressions.push('#role = :role');
    expressionAttributeValues[':role'] = input.role;
    expressionAttributeNames['#role'] = 'role';
  }

  if (input.isActive !== undefined) {
    updateExpressions.push('isActive = :isActive');
    expressionAttributeValues[':isActive'] = input.isActive;
  }

  if (input.displayName !== undefined) {
    updateExpressions.push('displayName = :displayName');
    expressionAttributeValues[':displayName'] = input.displayName;
  }

  if (input.email !== undefined) {
    updateExpressions.push('email = :email');
    expressionAttributeValues[':email'] = input.email;
    // Keep the GSI1 email-lookup index consistent with the new email.
    updateExpressions.push('GSI1PK = :gsi1pk');
    expressionAttributeValues[':gsi1pk'] = `EMAIL#${input.email}`;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'METADATA',
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(Object.keys(expressionAttributeNames).length > 0
        ? { ExpressionAttributeNames: expressionAttributeNames }
        : {}),
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    })
  );

  return mapItemToUserRecord(result.Attributes as Record<string, unknown>);
}

/**
 * Map a DynamoDB item to a UserRecord.
 */
function mapItemToUserRecord(item: Record<string, unknown>): UserRecord {
  return {
    userId: item['userId'] as string,
    email: item['email'] as string,
    displayName: item['displayName'] as string,
    role: item['role'] as UserRecord['role'],
    isActive: item['isActive'] as boolean,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };
}
