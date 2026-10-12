import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import {
  listTeams,
  createNewTeam,
  updateExistingTeam,
  deleteExistingTeam,
  listTeamMembers,
  addMemberToTeam,
  removeMemberFromTeam,
} from '../services/team-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * GET /admin/teams
 *
 * Retrieves teams accessible to the authenticated user.
 * - ADMIN: all teams
 * - TEAM_LEADER: only their own teams
 *
 * Response: { data: TeamRecord[] }
 */
export async function listTeamsHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teams = await listTeams(user);
    return successResponse({ data: teams });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * POST /admin/teams
 *
 * Creates a new team.
 * - ADMIN: can create any team
 * - TEAM_LEADER: can create a team (they become a member)
 *
 * Request body: { name: string, members?: string[] }
 * Response: { data: TeamRecord }
 */
export async function createTeamHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const body = parseBody(event.body);

    const team = await createNewTeam(user, {
      name: body.name as string,
      members: body.members as string[] | undefined,
    });

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'TEAM_MANAGEMENT',
      resourceId: team.teamId,
      resourceType: 'Team',
      metadata: { reason: 'Team created', resourceName: body.name as string },
    });

    return successResponse({ data: team }, 201);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * PATCH /admin/teams/{teamId}
 *
 * Updates a team.
 * - ADMIN: can update any team
 * - TEAM_LEADER: can only update their own team (Req 13.9)
 *
 * Request body: { name?: string }
 * Response: { data: TeamRecord }
 */
export async function updateTeamHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }

    const body = parseBody(event.body);

    const updated = await updateExistingTeam(user, teamId, {
      name: body.name as string,
    });

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'TEAM_MANAGEMENT',
      resourceId: teamId,
      resourceType: 'Team',
      metadata: { reason: 'Team updated', resourceName: body.name as string },
    });

    return successResponse({ data: updated });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * DELETE /admin/teams/{teamId}
 *
 * Deletes a team and cascades: removes all TeamAssignments and TeamMemberships.
 * Revokes ReviewAssignments for members who lose all team memberships.
 * - ADMIN only (Req 13.10)
 *
 * Response: { data: { deleted: true } }
 */
export async function deleteTeamHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }

    await deleteExistingTeam(user, teamId);

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'TEAM_MANAGEMENT',
      resourceId: teamId,
      resourceType: 'Team',
      metadata: { reason: 'Team deleted' },
    });

    return successResponse({ data: { deleted: true } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * GET /admin/teams/{teamId}/members
 *
 * Get members of a team.
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 *
 * Response: { data: TeamMembershipRecord[] }
 */
export async function listTeamMembersHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }

    const members = await listTeamMembers(user, teamId);

    return successResponse({ data: members });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * POST /admin/teams/{teamId}/members
 *
 * Add a member to a team.
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 *
 * Request body: { userId: string }
 * Response: { data: TeamMembershipRecord }
 */
export async function addTeamMemberHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }

    const body = parseBody(event.body);

    const membership = await addMemberToTeam(
      user,
      teamId,
      body.userId as string
    );

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'TEAM_MANAGEMENT',
      resourceId: teamId,
      resourceType: 'TeamMembership',
      metadata: { reason: 'Member added', resourceName: body.userId as string },
    });

    return successResponse({ data: membership }, 201);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * DELETE /admin/teams/{teamId}/members/{userId}
 *
 * Remove a member from a team.
 * When a user loses all team memberships, their ReviewAssignments are revoked (Req 13.8).
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 *
 * Response: { data: { deleted: true } }
 */
export async function removeTeamMemberHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;
    const userId = event.pathParameters?.userId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }
    if (!userId) {
      throw validationError('ユーザーIDは必須です。');
    }

    await removeMemberFromTeam(user, teamId, userId);

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'TEAM_MANAGEMENT',
      resourceId: teamId,
      resourceType: 'TeamMembership',
      metadata: { reason: 'Member removed', resourceName: userId },
    });

    return successResponse({ data: { deleted: true } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * Parse JSON body from event, returning empty object on failure.
 */
function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}
