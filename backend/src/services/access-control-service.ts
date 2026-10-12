import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import {
  type AuthUser,
  isAdmin,
  denyResourceAccess,
  requireRole,
} from '../utils/auth-middleware.js';
import { getModel } from '../repositories/language-model-repository.js';
import type { LanguageModelMetadata } from '../types/index.js';

/**
 * AccessControlService handles team-based resource access control.
 *
 * Access rules:
 * - ADMIN can access all resources
 * - TEAM_LEADER can manage their own team's resources
 * - REVIEWER can only access sessions assigned to their team or directly assigned to them
 *
 * When a user tries to access another team's resource, 404 is returned (not 403)
 * to hide the existence of the resource.
 */

/**
 * Check if a user has access to a specific session.
 * Access is granted if:
 * 1. User is ADMIN (full access)
 * 2. User's team has a TeamAssignment for the session AND user is a member of that team
 * 3. User has a direct ReviewAssignment for the session
 *
 * Returns 404 if access is denied (hides resource existence).
 */
export async function checkSessionAccess(
  user: AuthUser,
  sessionId: string
): Promise<void> {
  if (isAdmin(user)) {
    return;
  }

  const hasAccess = await userHasSessionAccess(user.userId, sessionId);
  if (!hasAccess) {
    denyResourceAccess();
  }
}

/**
 * Check if a user belongs to a specific team.
 * Returns true if the user is a member of the team.
 */
export async function isTeamMember(
  userId: string,
  teamId: string
): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
        ':sk': `MEMBER#${userId}`,
      },
      Limit: 1,
    })
  );

  return (result.Items?.length ?? 0) > 0;
}

/**
 * Check if a team has a TeamAssignment for a specific session.
 */
export async function hasTeamAssignment(
  teamId: string,
  sessionId: string
): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
        ':sk': `ASSIGNMENT#${sessionId}`,
      },
      Limit: 1,
    })
  );

  return (result.Items?.length ?? 0) > 0;
}

/**
 * Check if a user has a direct ReviewAssignment for a session.
 */
export async function hasReviewAssignment(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `ASSIGNMENT#${sessionId}`,
      },
      Limit: 1,
    })
  );

  return (result.Items?.length ?? 0) > 0;
}

/**
 * Get all team IDs that a user belongs to.
 * Uses GSI1 with PK=USER#{userId} to find all team memberships.
 */
export async function getUserTeamIds(userId: string): Promise<string[]> {
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

  return (result.Items ?? []).map((item) => {
    const gsi1sk = item['GSI1SK'] as string;
    return gsi1sk.replace('TEAM#', '');
  });
}

/**
 * Check if a session is assigned to any of the user's teams.
 * Uses GSI1 on TeamAssignment: GSI1PK=SESSION#{sessionId}, GSI1SK=TEAM#{teamId}
 */
export async function isSessionAssignedToUserTeams(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const userTeamIds = await getUserTeamIds(userId);

  if (userTeamIds.length === 0) {
    return false;
  }

  // Query GSI1 to find which teams have this session assigned
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `SESSION#${sessionId}`,
        ':prefix': 'TEAM#',
      },
    })
  );

  const assignedTeamIds = (result.Items ?? []).map((item) => {
    const gsi1sk = item['GSI1SK'] as string;
    return gsi1sk.replace('TEAM#', '');
  });

  // Check if any of the user's teams have this session assigned
  return userTeamIds.some((teamId) => assignedTeamIds.includes(teamId));
}

/**
 * Internal helper: Check if a user has access to a session via team or direct assignment.
 */
async function userHasSessionAccess(
  userId: string,
  sessionId: string
): Promise<boolean> {
  // Check direct ReviewAssignment first (faster, single query)
  const hasDirectAssignment = await hasReviewAssignment(userId, sessionId);
  if (hasDirectAssignment) {
    return true;
  }

  // Check team-based access
  return isSessionAssignedToUserTeams(userId, sessionId);
}

/**
 * Require that a TEAM_LEADER is operating on their own team.
 * ADMIN can operate on any team.
 * Returns 403 if TEAM_LEADER tries to access another team.
 */
export async function requireTeamAccess(
  user: AuthUser,
  teamId: string
): Promise<void> {
  if (isAdmin(user)) {
    return;
  }

  requireRole(user, 'TEAM_LEADER');

  const isMember = await isTeamMember(user.userId, teamId);
  if (!isMember) {
    denyResourceAccess();
  }
}

/**
 * Check whether two users share at least one team.
 * Used to determine whether a TEAM_LEADER can act on resources uploaded by
 * another user (they must be a member of one of the leader's teams).
 */
export async function usersShareTeam(
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  if (userIdA === userIdB) {
    return true;
  }

  const [teamsA, teamsB] = await Promise.all([
    getUserTeamIds(userIdA),
    getUserTeamIds(userIdB),
  ]);

  if (teamsA.length === 0 || teamsB.length === 0) {
    return false;
  }

  const setB = new Set(teamsB);
  return teamsA.some((teamId) => setB.has(teamId));
}

/**
 * Determine whether a user can access a media file, based on the uploader.
 *
 * Access rules (Requirement: media file access control):
 * - ADMIN: any media file
 * - TEAM_LEADER: media files uploaded by themselves or by a member of one of their teams
 * - REVIEWER: only media files they uploaded themselves
 *
 * This is used for both listing (visibility) and deletion (authorization),
 * so that the two stay consistent.
 */
export async function canAccessMediaFile(
  user: AuthUser,
  uploadedBy: string
): Promise<boolean> {
  if (isAdmin(user)) {
    return true;
  }

  // Both REVIEWER and TEAM_LEADER can always access their own uploads.
  if (user.userId === uploadedBy) {
    return true;
  }

  // TEAM_LEADER can additionally access uploads by their team members.
  if (user.role === 'TEAM_LEADER') {
    return usersShareTeam(user.userId, uploadedBy);
  }

  // REVIEWER: only own uploads (already handled above).
  return false;
}

/**
 * Get all session IDs accessible to a user (for listing).
 * ADMIN: all sessions (no filter needed at this level)
 * Others: sessions assigned to user's teams + directly assigned sessions
 */
export async function getAccessibleSessionIds(
  user: AuthUser
): Promise<string[] | null> {
  if (isAdmin(user)) {
    // null means no filter needed (all sessions accessible)
    return null;
  }

  const sessionIds = new Set<string>();

  // Get sessions from team assignments
  const userTeamIds = await getUserTeamIds(user.userId);
  for (const teamId of userTeamIds) {
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

    for (const item of result.Items ?? []) {
      const sk = item['SK'] as string;
      sessionIds.add(sk.replace('ASSIGNMENT#', ''));
    }
  }

  // Get sessions from direct ReviewAssignments
  const reviewResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${user.userId}`,
        ':prefix': 'ASSIGNMENT#',
      },
    })
  );

  for (const item of reviewResult.Items ?? []) {
    const sk = item['SK'] as string;
    sessionIds.add(sk.replace('ASSIGNMENT#', ''));
  }

  return Array.from(sessionIds);
}

/**
 * Check whether a user can access a custom language model, and return its
 * metadata when access is granted.
 *
 * Access rules (team isolation for language models):
 * - The model metadata must exist and not be soft-deleted (deletionStatus
 *   'PENDING' is treated as nonexistent).
 * - ADMIN can access any model.
 * - Others can access the model only when its teamId is one of the caller's
 *   teams.
 *
 * On any violation (missing, PENDING, or other-team) a 404 is returned via
 * denyResourceAccess() to hide the existence of the resource.
 */
export async function checkLanguageModelAccess(
  user: AuthUser,
  modelName: string
): Promise<LanguageModelMetadata> {
  const model = await getModel(modelName);

  if (!model || model.deletionStatus === 'PENDING') {
    denyResourceAccess();
  }

  if (isAdmin(user)) {
    return model;
  }

  const teamIds = await getUserTeamIds(user.userId);
  if (teamIds.includes(model.teamId)) {
    return model;
  }

  denyResourceAccess();
}
