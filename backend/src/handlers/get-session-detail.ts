import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, notFoundError, internalError } from '../utils/error-handler.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { getSessionById } from '../repositories/session-repository.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';

/**
 * GET /sessions/{sessionId}
 * Retrieves detailed information about a specific session, including associated media file metadata.
 * Access control: user must have access to the session (via team or direct assignment).
 *
 * Response:
 *   { data: { session, mediaFile } }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パラメータが必要です。');
    }

    // Verify user has access to this session
    await checkSessionAccess(user, sessionId);

    try {
      const session = await getSessionById(sessionId);
      if (!session) {
        throw notFoundError('指定されたセッションが見つかりません。');
      }

      // Look up associated media file
      const mediaFile = await mediaFileRepository.getBySessionId(sessionId);

      return successResponse({
        data: {
          session,
          mediaFile: mediaFile
            ? {
                mediaFileId: mediaFile.mediaFileId,
                filename: mediaFile.filename,
                contentType: mediaFile.contentType,
                fileSize: mediaFile.fileSize,
                status: mediaFile.status,
                scanStatus: mediaFile.scanStatus,
              }
            : null,
        },
      });
    } catch (queryError: unknown) {
      if ((queryError as { statusCode?: number }).statusCode) {
        throw queryError;
      }
      throw internalError(
        'セッション詳細の取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
