import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser, isAdmin } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { getAllTeams, getTeamsByUserId } from '../repositories/team-repository.js';

/**
 * GET /me/teams
 *
 * Returns the teams available to the caller for the language-model create form:
 * - ADMIN  -> every team (getAllTeams)
 * - others -> only the caller's own teams (getTeamsByUserId)
 *
 * This feeds the required team selector when creating a custom language model
 * (ADMIN may pick any team; TEAM_LEADER picks one of their own teams).
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const teams = isAdmin(user)
      ? await getAllTeams()
      : await getTeamsByUserId(user.userId);

    return successResponse({ data: teams });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
