import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import {
  listAssignments,
  createAssignment,
  deleteAssignment,
  createUserReviewAssignment,
} from '../services/team-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * GET /admin/teams/{teamId}/assignments
 *
 * Get all TeamAssignments for a team.
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team
 *
 * Response: { data: TeamAssignmentRecord[] }
 */
export async function listTeamAssignmentsHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }

    const assignments = await listAssignments(user, teamId);

    return successResponse({ data: assignments });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * POST /admin/teams/{teamId}/assignments
 *
 * Create a TeamAssignment (assign a session to a team).
 * All team members gain access to the session (Req 13.4).
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 *
 * Request body: { sessionId: string }
 * Response: { data: TeamAssignmentRecord }
 */
export async function createTeamAssignmentHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }

    const body = parseBody(event.body);

    const assignment = await createAssignment(
      user,
      teamId,
      body.sessionId as string
    );

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'TEAM_ASSIGNMENT_CHANGE',
      resourceId: `${teamId}:${body.sessionId as string}`,
      resourceType: 'TeamAssignment',
      metadata: { reason: 'TeamAssignment created' },
    });

    return successResponse({ data: assignment }, 201);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * DELETE /admin/teams/{teamId}/assignments/{sessionId}
 *
 * Delete a TeamAssignment.
 * Members without other assignments lose access on next access attempt (Req 13.5).
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 *
 * Response: { data: { deleted: true } }
 */
export async function deleteTeamAssignmentHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;
    const sessionId = event.pathParameters?.sessionId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }
    if (!sessionId) {
      throw validationError('セッションIDは必須です。');
    }

    await deleteAssignment(user, teamId, sessionId);

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'TEAM_ASSIGNMENT_CHANGE',
      resourceId: `${teamId}:${sessionId}`,
      resourceType: 'TeamAssignment',
      metadata: { reason: 'TeamAssignment deleted' },
    });

    return successResponse({ data: { deleted: true } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * POST /admin/teams/{teamId}/review-assignments
 *
 * Create a ReviewAssignment (assign a session directly to a user).
 * The user must be a member of the team (Req 13.8).
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team members (Req 13.9)
 *
 * Request body: { userId: string, sessionId: string }
 * Response: { data: ReviewAssignmentRecord }
 */
export async function createReviewAssignmentHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const teamId = event.pathParameters?.teamId;

    if (!teamId) {
      throw validationError('チームIDは必須です。');
    }

    const body = parseBody(event.body);

    const assignment = await createUserReviewAssignment(
      user,
      teamId,
      body.userId as string,
      body.sessionId as string
    );

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'REVIEW_ASSIGNMENT_CHANGE',
      resourceId: `${body.userId as string}:${body.sessionId as string}`,
      resourceType: 'ReviewAssignment',
      metadata: { reason: 'ReviewAssignment created' },
    });

    return successResponse({ data: assignment }, 201);
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
