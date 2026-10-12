import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { deleteModel } from '../services/language-model-service.js';

/**
 * DELETE /language-models/{modelName}
 *
 * Deletes a custom language model (two-layer teardown: soft-delete -> Transcribe
 * DeleteLanguageModel -> S3 training-data delete -> hard-delete metadata).
 * - Validates JWT and extracts user
 * - Validates the modelName path parameter
 * - Delegates team isolation + role check, training/in-use eligibility, the
 *   idempotent ordered teardown (re-runnable recovery), and the
 *   LANGUAGE_MODEL_DELETED audit log to the service (deleteModel)
 * - Returns { deleted: true } on success
 *
 * The operation is idempotent: re-invoking the same DELETE after a mid-sequence
 * failure resumes the remaining steps and still succeeds.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const modelName = event.pathParameters?.modelName;
    if (!modelName) {
      throw validationError('modelName パスパラメータが必要です。');
    }

    try {
      await deleteModel(user, modelName);
      return successResponse({ data: { deleted: true } });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw internalError(
        'モデルの削除に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
