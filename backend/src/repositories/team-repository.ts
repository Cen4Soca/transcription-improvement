import {
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

export interface TeamRecord {
  teamId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMembershipRecord {
  teamId: string;
  userId: string;
  createdAt: string;
}

export interface TeamAssignmentRecord {
  teamId: string;
  sessionId: string;
  createdBy: string;
  createdAt: string;
}

export interface ReviewAssignmentRecord {
  userId: string;
  sessionId: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Get a single team by ID.
 */
export async function getTeamById(teamId: string): Promise<TeamRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `TEAM#${teamId}`,
        SK: 'METADATA',
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return mapItemToTeamRecord(result.Item);
}

/**
 * Get all teams. Uses a scan with entityType filter.
 */
export async function getAllTeams(): Promise<TeamRecord[]> {
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');

  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityType = :entityType AND SK = :sk',
      ExpressionAttributeValues: {
        ':entityType': 'Team',
        ':sk': 'METADATA',
      },
    })
  );

  return (result.Items ?? []).map(mapItemToTeamRecord);
}

/**
 * Get teams that a user belongs to.
 * Uses GSI1 with GSI1PK=USER#{userId} and GSI1SK begins_with TEAM#.
 */
export async function getTeamsByUserId(userId: string): Promise<TeamRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `USER#${userId}`,
        ':prefix': 'TEAM#',
      },
    })
  );

  const teamIds = (result.Items ?? []).map((item) => {
    const gsi1sk = item['GSI1SK'] as string;
    return gsi1sk.replace('TEAM#', '');
  });

  if (teamIds.length === 0) {
    return [];
  }

  // Fetch team metadata for each team
  const teams: TeamRecord[] = [];
  for (const teamId of teamIds) {
    const team = await getTeamById(teamId);
    if (team) {
      teams.push(team);
    }
  }

  return teams;
}

/**
 * Create a new team.
 */
export async function createTeam(input: {
  teamId: string;
  name: string;
  createdBy: string;
}): Promise<TeamRecord> {
  const now = new Date().toISOString();

  const item = {
    PK: `TEAM#${input.teamId}`,
    SK: 'METADATA',
    entityType: 'Team',
    teamId: input.teamId,
    name: input.name,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return {
    teamId: input.teamId,
    name: input.name,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a team's name.
 */
export async function updateTeam(
  teamId: string,
  updates: { name: string }
): Promise<TeamRecord> {
  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `TEAM#${teamId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET #name = :name, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#name': 'name',
      },
      ExpressionAttributeValues: {
        ':name': updates.name,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return mapItemToTeamRecord(result.Attributes as Record<string, unknown>);
}

/**
 * Delete a team (metadata only).
 */
export async function deleteTeam(teamId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `TEAM#${teamId}`,
        SK: 'METADATA',
      },
    })
  );
}

/**
 * Get all members of a team.
 */
export async function getTeamMembers(teamId: string): Promise<TeamMembershipRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
        ':prefix': 'MEMBER#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    teamId,
    userId: (item['SK'] as string).replace('MEMBER#', ''),
    createdAt: item['createdAt'] as string,
  }));
}

/**
 * Add a member to a team.
 */
export async function addTeamMember(
  teamId: string,
  userId: string
): Promise<TeamMembershipRecord> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `TEAM#${teamId}`,
        SK: `MEMBER#${userId}`,
        GSI1PK: `USER#${userId}`,
        GSI1SK: `TEAM#${teamId}`,
        entityType: 'TeamMembership',
        teamId,
        userId,
        createdAt: now,
      },
    })
  );

  return { teamId, userId, createdAt: now };
}

/**
 * Remove a member from a team.
 */
export async function removeTeamMember(
  teamId: string,
  userId: string
): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `TEAM#${teamId}`,
        SK: `MEMBER#${userId}`,
      },
    })
  );
}

/**
 * Get all TeamAssignments for a team.
 */
export async function getTeamAssignments(
  teamId: string
): Promise<TeamAssignmentRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
        ':prefix': 'ASSIGNMENT#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    teamId,
    sessionId: (item['SK'] as string).replace('ASSIGNMENT#', ''),
    createdBy: item['createdBy'] as string,
    createdAt: item['createdAt'] as string,
  }));
}

/**
 * Create a TeamAssignment (assign a session to a team).
 */
export async function createTeamAssignment(input: {
  teamId: string;
  sessionId: string;
  createdBy: string;
}): Promise<TeamAssignmentRecord> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `TEAM#${input.teamId}`,
        SK: `ASSIGNMENT#${input.sessionId}`,
        GSI1PK: `SESSION#${input.sessionId}`,
        GSI1SK: `TEAM#${input.teamId}`,
        entityType: 'TeamAssignment',
        teamId: input.teamId,
        sessionId: input.sessionId,
        createdBy: input.createdBy,
        createdAt: now,
      },
    })
  );

  return {
    teamId: input.teamId,
    sessionId: input.sessionId,
    createdBy: input.createdBy,
    createdAt: now,
  };
}

/**
 * Delete a TeamAssignment.
 */
export async function deleteTeamAssignment(
  teamId: string,
  sessionId: string
): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `TEAM#${teamId}`,
        SK: `ASSIGNMENT#${sessionId}`,
      },
    })
  );
}

/**
 * Delete all TeamAssignments for a team (cascade on team deletion).
 */
export async function deleteAllTeamAssignments(teamId: string): Promise<void> {
  const assignments = await getTeamAssignments(teamId);

  if (assignments.length === 0) {
    return;
  }

  // BatchWrite has a limit of 25 items per request
  const batches: TeamAssignmentRecord[][] = [];
  for (let i = 0; i < assignments.length; i += 25) {
    batches.push(assignments.slice(i, i + 25));
  }

  for (const batch of batches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((assignment) => ({
            DeleteRequest: {
              Key: {
                PK: `TEAM#${teamId}`,
                SK: `ASSIGNMENT#${assignment.sessionId}`,
              },
            },
          })),
        },
      })
    );
  }
}

/**
 * Delete all TeamMemberships for a team (cascade on team deletion).
 */
export async function deleteAllTeamMembers(teamId: string): Promise<void> {
  const members = await getTeamMembers(teamId);

  if (members.length === 0) {
    return;
  }

  const batches: TeamMembershipRecord[][] = [];
  for (let i = 0; i < members.length; i += 25) {
    batches.push(members.slice(i, i + 25));
  }

  for (const batch of batches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((member) => ({
            DeleteRequest: {
              Key: {
                PK: `TEAM#${teamId}`,
                SK: `MEMBER#${member.userId}`,
              },
            },
          })),
        },
      })
    );
  }
}

/**
 * Create a ReviewAssignment (assign a session directly to a user).
 */
export async function createReviewAssignment(input: {
  userId: string;
  sessionId: string;
  createdBy: string;
}): Promise<ReviewAssignmentRecord> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${input.userId}`,
        SK: `ASSIGNMENT#${input.sessionId}`,
        GSI1PK: `SESSION#${input.sessionId}`,
        GSI1SK: `USER#${input.userId}`,
        entityType: 'ReviewAssignment',
        userId: input.userId,
        sessionId: input.sessionId,
        createdBy: input.createdBy,
        createdAt: now,
      },
    })
  );

  return {
    userId: input.userId,
    sessionId: input.sessionId,
    createdBy: input.createdBy,
    createdAt: now,
  };
}

/**
 * Get all ReviewAssignments for a user.
 * Uses PK=USER#{userId} with SK begins_with ASSIGNMENT#.
 */
export async function getReviewAssignmentsByUser(
  userId: string
): Promise<ReviewAssignmentRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':prefix': 'ASSIGNMENT#',
      },
    })
  );

  return (result.Items ?? [])
    .filter((item) => item['entityType'] === 'ReviewAssignment')
    .map((item) => ({
      userId,
      sessionId: (item['SK'] as string).replace('ASSIGNMENT#', ''),
      createdBy: item['createdBy'] as string,
      createdAt: item['createdAt'] as string,
    }));
}

/**
 * Delete a ReviewAssignment.
 */
export async function deleteReviewAssignment(
  userId: string,
  sessionId: string
): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `ASSIGNMENT#${sessionId}`,
      },
    })
  );
}

/**
 * Map a DynamoDB item to a TeamRecord.
 */
function mapItemToTeamRecord(item: Record<string, unknown>): TeamRecord {
  return {
    teamId: item['teamId'] as string,
    name: item['name'] as string,
    createdBy: item['createdBy'] as string,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };
}
