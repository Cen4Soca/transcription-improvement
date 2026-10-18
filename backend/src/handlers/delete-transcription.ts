import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { deleteTranscription } from '../services/deletion-service.js';

/**
 * DELETE /sessions/{sessionId}/transcription
 *
 * Deletes a transcription and all related data (cascade delete).
 * - Validates JWT and extracts user (Admin/TeamLeader only)
 * - Extracts sessionId from path parameters
 * - Calls DeletionService.deleteTranscription()
 * - Returns 200 on success
 *
 * Requirements: 7.3, 7.5, 7.8
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Role check: Admin/TeamLeader only
    requireRole(user, 'TEAM_LEADER');

    // Extract sessionId from path parameters
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パスパラメータは必須です。');
    }

    // Extract teamId from JWT claims (optional)
    const teamId = event.requestContext.authorizer.jwt.claims['custom:teamId'] as string | undefined;

    // Delete transcription (cascade)
    await deleteTranscription({
      sessionId,
      userId: user.userId,
      userRole: user.role,
      userTeamId: teamId || undefined,
    });

    return successResponse({ message: 'Transcription を削除しました。' });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
