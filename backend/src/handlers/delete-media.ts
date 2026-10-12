import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { deleteMediaFile } from '../services/deletion-service.js';

/**
 * DELETE /media-files/{mediaFileId}
 *
 * Deletes a media file (S3 object + DynamoDB metadata).
 * - Validates JWT and extracts user
 * - Extracts mediaFileId from path parameters
 * - Calls DeletionService.deleteMediaFile() which enforces uploadedBy-based
 *   access control:
 *     - ADMIN: any media file
 *     - TEAM_LEADER: files uploaded by their team members (and themselves)
 *     - REVIEWER: only files they uploaded themselves
 * - Returns 200 on success
 *
 * Requirements: 7.3, 7.5, 7.8
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Extract mediaFileId from path parameters
    const mediaFileId = event.pathParameters?.mediaFileId;
    if (!mediaFileId) {
      throw validationError('mediaFileId パスパラメータは必須です。');
    }

    // force=true confirms deletion of media linked to an IN_PROGRESS session.
    const force = event.queryStringParameters?.force === 'true';

    // Delete media file (access control is enforced inside the service)
    await deleteMediaFile({
      mediaFileId,
      user,
      force,
    });

    return successResponse({ message: 'メディアファイルを削除しました。' });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
