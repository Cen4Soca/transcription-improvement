import { QueryCommand, BatchGetCommand, PutCommand, UpdateCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

export interface SessionRecord {
  sessionId: string;
  name: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  /**
   * userId of the reviewer this session is assigned to.
   * Set on upload (uploader), by a claim (reviewer picks it up), or by an
   * explicit assignment from a TEAM_LEADER / ADMIN. When set, the session is
   * considered "claimed" and other reviewers cannot claim it.
   */
  assignedUserId?: string;
  /**
   * teamId this session is assigned to. Reviewers who belong to this team can
   * claim the session. Set by a TEAM_LEADER / ADMIN team assignment.
   */
  assignedTeamId?: string;
  assignedReviewerCount: number;
  consensusThreshold: number;
  /** True when the linked media file has been deleted (set by deletion-service). */
  mediaFileDeleted?: boolean;
  /**
   * Master list of speaker labels for this session. The review UI shows the
   * union of these labels and the labels derived from each segment.
   */
  speakerLabels?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSessionResult {
  items: SessionRecord[];
  lastEvaluatedKey?: Record<string, unknown>;
  totalItems: number;
}

export const SESSION_PAGE_SIZE = 50;

/**
 * Query all sessions for a specific team, sorted by createdAt descending.
 * Uses GSI1 with GSI1PK=TEAM#{teamId} and GSI1SK begins_with SESSION#.
 */
export async function getSessionsByTeamId(
  teamId: string
): Promise<SessionRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `TEAM#${teamId}`,
        ':prefix': 'SESSION#',
      },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []).map(mapItemToSessionRecord);
}

/**
 * Get sessions by a list of session IDs.
 * Uses BatchGetItem to fetch session metadata for specific IDs.
 */
export async function getSessionsByIds(
  sessionIds: string[]
): Promise<SessionRecord[]> {
  if (sessionIds.length === 0) {
    return [];
  }

  // BatchGetItem has a limit of 100 items per request
  const batches: string[][] = [];
  for (let i = 0; i < sessionIds.length; i += 100) {
    batches.push(sessionIds.slice(i, i + 100));
  }

  const allSessions: SessionRecord[] = [];

  for (const batch of batches) {
    const keys = batch.map((sessionId) => ({
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    }));

    const result = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: keys,
          },
        },
      })
    );

    const items = result.Responses?.[TABLE_NAME] ?? [];
    allSessions.push(...items.map(mapItemToSessionRecord));
  }

  return allSessions;
}

/**
 * Get all sessions (for ADMIN users), sorted by createdAt descending.
 * Queries all items with entityType=ReviewSession using a scan-like approach via GSI1.
 * Since ADMIN needs all sessions, we query by PK=SESSION# prefix on the main table.
 */
export async function getAllSessions(): Promise<SessionRecord[]> {
  // Query all SESSION# items with SK=METADATA
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': 'ALL_SESSIONS',
        ':prefix': 'SESSION#',
      },
      ScanIndexForward: false,
    })
  );

  // If no items found via ALL_SESSIONS index, fall back to scanning by entity type
  if (result.Items && result.Items.length > 0) {
    return result.Items.map(mapItemToSessionRecord);
  }

  // Fallback: use a scan with filter (less efficient but works without ALL_SESSIONS GSI entry)
  return scanAllSessions();
}

/**
 * Fallback scan for all sessions when GSI1 ALL_SESSIONS key is not populated.
 * Scans the table filtering by entityType=ReviewSession.
 */
async function scanAllSessions(): Promise<SessionRecord[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityType = :entityType AND SK = :sk',
      ExpressionAttributeValues: {
        ':entityType': 'ReviewSession',
        ':sk': 'METADATA',
      },
    })
  );

  return (result.Items ?? []).map(mapItemToSessionRecord);
}

/**
 * Query sessions for a specific team with pagination support.
 * Uses GSI1 with GSI1PK=TEAM#{teamId} and GSI1SK begins_with SESSION#.
 * Results are sorted by createdAt descending (ScanIndexForward: false).
 */
export async function getSessionsByTeamIdPaginated(
  teamId: string,
  options?: {
    limit?: number;
    exclusiveStartKey?: Record<string, unknown>;
    status?: string;
  }
): Promise<PaginatedSessionResult> {
  const limit = options?.limit ?? SESSION_PAGE_SIZE;

  const queryParams: Record<string, unknown> = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression:
      'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
    ExpressionAttributeValues: {
      ':gsi1pk': `TEAM#${teamId}`,
      ':prefix': 'SESSION#',
    } as Record<string, unknown>,
    ScanIndexForward: false,
    Limit: limit,
  };

  if (options?.exclusiveStartKey) {
    (queryParams as { ExclusiveStartKey?: Record<string, unknown> }).ExclusiveStartKey = options.exclusiveStartKey;
  }

  if (options?.status) {
    (queryParams as { FilterExpression?: string }).FilterExpression = '#status = :statusVal';
    (queryParams as { ExpressionAttributeNames?: Record<string, string> }).ExpressionAttributeNames = {
      '#status': 'status',
    };
    ((queryParams as { ExpressionAttributeValues: Record<string, unknown> }).ExpressionAttributeValues)[':statusVal'] = options.status;
  }

  const result = await docClient.send(new QueryCommand(queryParams as ConstructorParameters<typeof QueryCommand>[0]));

  const items = (result.Items ?? []).map(mapItemToSessionRecord);

  return {
    items,
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    totalItems: items.length,
  };
}

/**
 * Get all sessions with pagination support (for ADMIN users).
 * Uses a scan with entityType filter and pagination.
 */
export async function getAllSessionsPaginated(
  options?: {
    limit?: number;
    exclusiveStartKey?: Record<string, unknown>;
    status?: string;
  }
): Promise<PaginatedSessionResult> {
  const limit = options?.limit ?? SESSION_PAGE_SIZE;

  let filterExpression = 'entityType = :entityType AND SK = :sk';
  const expressionAttributeValues: Record<string, unknown> = {
    ':entityType': 'ReviewSession',
    ':sk': 'METADATA',
  };

  if (options?.status) {
    filterExpression += ' AND #status = :statusVal';
    expressionAttributeValues[':statusVal'] = options.status;
  }

  const scanParams: Record<string, unknown> = {
    TableName: TABLE_NAME,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    Limit: limit,
  };

  if (options?.status) {
    (scanParams as { ExpressionAttributeNames?: Record<string, string> }).ExpressionAttributeNames = {
      '#status': 'status',
    };
  }

  if (options?.exclusiveStartKey) {
    (scanParams as { ExclusiveStartKey?: Record<string, unknown> }).ExclusiveStartKey = options.exclusiveStartKey;
  }

  const result = await docClient.send(new ScanCommand(scanParams as ConstructorParameters<typeof ScanCommand>[0]));

  const items = (result.Items ?? []).map(mapItemToSessionRecord);

  return {
    items,
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    totalItems: items.length,
  };
}

/**
 * Count total sessions accessible to a user (for pagination metadata).
 * For ADMIN: counts all sessions.
 * For others: counts sessions in the provided IDs list.
 */
export async function countAllSessions(status?: string): Promise<number> {
  let filterExpression = 'entityType = :entityType AND SK = :sk';
  const expressionAttributeValues: Record<string, unknown> = {
    ':entityType': 'ReviewSession',
    ':sk': 'METADATA',
  };

  if (status) {
    filterExpression += ' AND #status = :statusVal';
    expressionAttributeValues[':statusVal'] = status;
  }

  const scanParams: Record<string, unknown> = {
    TableName: TABLE_NAME,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    Select: 'COUNT',
  };

  if (status) {
    (scanParams as { ExpressionAttributeNames?: Record<string, string> }).ExpressionAttributeNames = {
      '#status': 'status',
    };
  }

  const result = await docClient.send(new ScanCommand(scanParams as ConstructorParameters<typeof ScanCommand>[0]));

  return result.Count ?? 0;
}

/**
 * Filter sessions by status.
 */
export function filterByStatus(
  sessions: SessionRecord[],
  status: string
): SessionRecord[] {
  return sessions.filter((session) => session.status === status);
}

/**
 * Sort sessions by createdAt descending.
 */
export function sortByCreatedAtDesc(sessions: SessionRecord[]): SessionRecord[] {
  return [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Get a single session by ID.
 */
export async function getSessionById(
  sessionId: string
): Promise<SessionRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return mapItemToSessionRecord(result.Item);
}

/**
 * Update the status of a ReviewSession.
 * Returns the updated session record.
 */
export async function updateSessionStatus(
  sessionId: string,
  status: SessionRecord['status']
): Promise<SessionRecord> {
  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return mapItemToSessionRecord(result.Attributes as Record<string, unknown>);
}

/**
 * Update the name of a ReviewSession.
 * Returns the updated session record.
 * `name` is a DynamoDB reserved word, so it is aliased via ExpressionAttributeNames.
 */
export async function updateSessionName(
  sessionId: string,
  name: string
): Promise<SessionRecord> {
  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET #name = :name, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#name': 'name',
      },
      ExpressionAttributeValues: {
        ':name': name,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return mapItemToSessionRecord(result.Attributes as Record<string, unknown>);
}

/**
 * Update the speaker-label master list of a ReviewSession.
 * Overwrites the whole `speakerLabels` attribute and refreshes `updatedAt`.
 * Returns the updated session record.
 */
export async function updateSessionSpeakerLabels(
  sessionId: string,
  labels: string[]
): Promise<SessionRecord> {
  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET speakerLabels = :labels, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':labels': labels,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return mapItemToSessionRecord(result.Attributes as Record<string, unknown>);
}

/**
 * Collect the distinct speaker labels assigned to the segments of a session.
 * Queries PK=SESSION#{sessionId} with SK begins_with SEGMENT# and returns the
 * unique, non-empty `speakerLabel` values in order of first appearance.
 */
export async function getSegmentSpeakerLabels(
  sessionId: string
): Promise<string[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'SEGMENT#',
      },
      ScanIndexForward: true,
    })
  );

  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of result.Items ?? []) {
    const label = item['speakerLabel'] as string | undefined;
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  return labels;
}

/**
 * @deprecated Superseded by {@link getSessionsByParticipantUserId}, which lists
 * every session a reviewer participates in (not just an exclusive assignment).
 * Retained for backward compatibility with the single-assignee model.
 *
 * Query sessions assigned to a specific user via GSI2.
 * GSI2PK=USER#{userId}, GSI2SK begins_with SESSION#.
 * Sorted by assignment time descending.
 */
export async function getSessionsByAssignedUserId(
  userId: string
): Promise<SessionRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression:
        'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi2pk': `USER#${userId}`,
        ':prefix': 'SESSION#',
      },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []).map(mapItemToSessionRecord);
}

export interface UpdateAssignmentInput {
  /** userId to assign the session to. Pass null to clear the user assignment. */
  assignedUserId?: string | null;
  /** teamId to assign the session to. Pass null to clear the team assignment. */
  assignedTeamId?: string | null;
}

/**
 * Update the assignment of a session (user and/or team).
 * Rewrites GSI1 (team) and GSI2 (user) keys accordingly so the assignment
 * lookups stay consistent. Passing null for a field clears that assignment.
 * Used by ADMIN / TEAM_LEADER to (re)assign a session.
 */
export async function updateSessionAssignment(
  sessionId: string,
  input: UpdateAssignmentInput
): Promise<SessionRecord> {
  const now = new Date().toISOString();

  const setParts: string[] = ['updatedAt = :updatedAt'];
  const removeParts: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': now };

  // --- assignedUserId + GSI2 ---
  if (input.assignedUserId !== undefined) {
    if (input.assignedUserId === null) {
      removeParts.push('assignedUserId', 'GSI2PK', 'GSI2SK');
    } else {
      names['#assignedUserId'] = 'assignedUserId';
      values[':assignedUserId'] = input.assignedUserId;
      values[':gsi2pk'] = `USER#${input.assignedUserId}`;
      values[':gsi2sk'] = `SESSION#${now}#${sessionId}`;
      setParts.push(
        '#assignedUserId = :assignedUserId',
        'GSI2PK = :gsi2pk',
        'GSI2SK = :gsi2sk'
      );
    }
  }

  // --- assignedTeamId + GSI1 ---
  if (input.assignedTeamId !== undefined) {
    if (input.assignedTeamId === null) {
      removeParts.push('assignedTeamId', 'GSI1PK', 'GSI1SK');
    } else {
      names['#assignedTeamId'] = 'assignedTeamId';
      values[':assignedTeamId'] = input.assignedTeamId;
      values[':gsi1pk'] = `TEAM#${input.assignedTeamId}`;
      values[':gsi1sk'] = `SESSION#${now}#${sessionId}`;
      setParts.push(
        '#assignedTeamId = :assignedTeamId',
        'GSI1PK = :gsi1pk',
        'GSI1SK = :gsi1sk'
      );
    }
  }

  let updateExpression = `SET ${setParts.join(', ')}`;
  if (removeParts.length > 0) {
    updateExpression += ` REMOVE ${removeParts.join(', ')}`;
  }

  const commandInput: Record<string, unknown> = {
    TableName: TABLE_NAME,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  };
  if (Object.keys(names).length > 0) {
    commandInput['ExpressionAttributeNames'] = names;
  }

  const result = await docClient.send(
    new UpdateCommand(commandInput as ConstructorParameters<typeof UpdateCommand>[0])
  );

  return mapItemToSessionRecord(result.Attributes as Record<string, unknown>);
}

/**
 * @deprecated Sessions are no longer exclusively claimed by a single reviewer.
 * Use {@link addParticipant} so multiple reviewers can join the same session
 * for consensus review. Retained only for backward compatibility.
 *
 * Atomically claim a session for a reviewer.
 * Succeeds only when the session has no assignedUserId yet (conditional write),
 * which guarantees that once one reviewer claims it, no other reviewer can.
 * Also indexes the assignment on GSI2 for per-user lookups.
 *
 * @throws ConditionalCheckFailedException when the session is already claimed.
 */
export async function claimSession(
  sessionId: string,
  userId: string
): Promise<SessionRecord> {
  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET assignedUserId = :userId, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk, updatedAt = :updatedAt',
      // Only succeed when the session exists and is not already claimed.
      ConditionExpression:
        'attribute_exists(PK) AND attribute_not_exists(assignedUserId)',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':gsi2pk': `USER#${userId}`,
        ':gsi2sk': `SESSION#${now}#${sessionId}`,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return mapItemToSessionRecord(result.Attributes as Record<string, unknown>);
}

// ============================================================
// SessionParticipant — multiple reviewers per session
// ============================================================

export interface ParticipantRecord {
  sessionId: string;
  userId: string;
  joinedAt: string;
}

/**
 * Add a reviewer as a participant of a session.
 *
 * Multiple reviewers may participate in the same session (the whole point of
 * consensus review), so this is NOT an exclusive claim. Re-joining is idempotent:
 * an existing participant record is left untouched and the session's
 * assignedReviewerCount is not double-counted.
 *
 * Key design:
 *   PK: SESSION#{sessionId}
 *   SK: PARTICIPANT#{userId}
 *   GSI2PK: USER#{userId}
 *   GSI2SK: PARTICIPANT#{joinedAt}#{sessionId}   (per-user participation lookup)
 *
 * @returns true when a new participant was added, false when already a participant.
 */
export async function addParticipant(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `PARTICIPANT#${userId}`,
          GSI2PK: `USER#${userId}`,
          GSI2SK: `PARTICIPANT#${now}#${sessionId}`,
          entityType: 'SessionParticipant',
          sessionId,
          userId,
          joinedAt: now,
        },
        // Only succeed when this user is not already a participant.
        ConditionExpression:
          'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      })
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      // Already a participant — idempotent no-op.
      return false;
    }
    throw error;
  }

  // A brand-new participant joined: bump the session's reviewer count atomically.
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET assignedReviewerCount = if_not_exists(assignedReviewerCount, :zero) + :one, updatedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': now,
      },
    })
  );

  return true;
}

/**
 * Get all participants of a session.
 * Queries PK=SESSION#{sessionId} and SK begins_with PARTICIPANT#.
 */
export async function getParticipants(
  sessionId: string
): Promise<ParticipantRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'PARTICIPANT#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    sessionId: item['sessionId'] as string,
    userId: item['userId'] as string,
    joinedAt: item['joinedAt'] as string,
  }));
}

/**
 * Count the participants of a session.
 */
export async function countParticipants(sessionId: string): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'PARTICIPANT#',
      },
      Select: 'COUNT',
    })
  );

  return result.Count ?? 0;
}

/**
 * Check whether a user is a participant of a session.
 */
export async function isParticipant(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: `PARTICIPANT#${userId}`,
      },
    })
  );

  return result.Item != null;
}

/**
 * List the session IDs a user participates in, via GSI2.
 * GSI2PK=USER#{userId}, GSI2SK begins_with PARTICIPANT#.
 */
export async function getSessionIdsByParticipantUserId(
  userId: string
): Promise<string[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression:
        'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi2pk': `USER#${userId}`,
        ':prefix': 'PARTICIPANT#',
      },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []).map((item) => item['sessionId'] as string);
}

/**
 * List the sessions a user participates in, resolved to full session records.
 * Combines the GSI2 participation lookup with a batch get of session metadata.
 */
export async function getSessionsByParticipantUserId(
  userId: string
): Promise<SessionRecord[]> {
  const sessionIds = await getSessionIdsByParticipantUserId(userId);
  if (sessionIds.length === 0) {
    return [];
  }
  return getSessionsByIds(sessionIds);
}

export interface CreateSessionInput {
  sessionId: string;
  transcriptionJobId: string;
  name: string;
  teamId?: string;
  /** userId of the reviewer this session is assigned to (the uploader). */
  assignedUserId?: string;
  /** teamId this session is assigned to for team-based claiming. */
  assignedTeamId?: string;
  assignedReviewerCount?: number;
  consensusThreshold?: number;
}

/**
 * Create a new ReviewSession with status PENDING.
 * Called when a new TranscriptionJob is registered (Requirement 5.6).
 *
 * When an initial reviewer (the uploader) is provided, they are registered as
 * the session's first participant so that multiple reviewers can subsequently
 * join the same session for consensus review.
 */
export async function createSession(
  input: CreateSessionInput
): Promise<SessionRecord> {
  const now = new Date().toISOString();

  // The uploader becomes the first participant (if provided), so the session
  // starts with a reviewer count of 1.
  const initialReviewerCount =
    input.assignedReviewerCount ?? (input.assignedUserId ? 1 : 0);

  const item: Record<string, unknown> = {
    PK: `SESSION#${input.sessionId}`,
    SK: 'METADATA',
    entityType: 'ReviewSession',
    sessionId: input.sessionId,
    transcriptionJobId: input.transcriptionJobId,
    name: input.name,
    status: 'PENDING',
    assignedReviewerCount: initialReviewerCount,
    consensusThreshold: input.consensusThreshold ?? 67,
    createdAt: now,
    updatedAt: now,
  };

  // The team a reviewer can join this session from. Defaults to the uploader's
  // team. Indexed on GSI1 (TEAM#) so reviewers can list their team's sessions.
  const assignedTeamId = input.assignedTeamId ?? input.teamId;
  if (assignedTeamId) {
    item['assignedTeamId'] = assignedTeamId;
    item['GSI1PK'] = `TEAM#${assignedTeamId}`;
    item['GSI1SK'] = `SESSION#${now}#${input.sessionId}`;
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  // Register the uploader as the first participant (per-user lookup via GSI2).
  if (input.assignedUserId) {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `SESSION#${input.sessionId}`,
          SK: `PARTICIPANT#${input.assignedUserId}`,
          GSI2PK: `USER#${input.assignedUserId}`,
          GSI2SK: `PARTICIPANT#${now}#${input.sessionId}`,
          entityType: 'SessionParticipant',
          sessionId: input.sessionId,
          userId: input.assignedUserId,
          joinedAt: now,
        },
      })
    );
  }

  return {
    sessionId: input.sessionId,
    name: input.name,
    status: 'PENDING',
    assignedUserId: input.assignedUserId,
    assignedTeamId,
    assignedReviewerCount: initialReviewerCount,
    consensusThreshold: input.consensusThreshold ?? 67,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Map a DynamoDB item to a SessionRecord.
 */
function mapItemToSessionRecord(item: Record<string, unknown>): SessionRecord {
  return {
    sessionId: item['sessionId'] as string,
    name: item['name'] as string,
    status: item['status'] as SessionRecord['status'],
    assignedUserId: (item['assignedUserId'] as string | undefined) ?? undefined,
    assignedTeamId: (item['assignedTeamId'] as string | undefined) ?? undefined,
    assignedReviewerCount: (item['assignedReviewerCount'] as number) ?? 0,
    consensusThreshold: (item['consensusThreshold'] as number) ?? 67,
    mediaFileDeleted: (item['mediaFileDeleted'] as boolean | undefined) ?? undefined,
    speakerLabels: (item['speakerLabels'] as string[] | undefined) ?? undefined,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };
}
