import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, forbiddenError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { updateUserProfile } from '../services/user-service.js';
import { getUserById, getUserByEmail } from '../repositories/user-repository.js';

/**
 * PATCH /me
 *
 * Allows the authenticated user to update their own profile
 * (display name and/or email). Role and active status cannot be
 * changed through this endpoint.
 *
 * Request body:
 *   { displayName?: string, email?: string }
 *
 * Response:
 *   { data: UserRecord }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const body = parseBody(event.body);

    // Reject privilege-related fields on a self-update.
    if ('role' in body || 'isActive' in body) {
      throw validationError(
        'This field cannot be changed.',
        undefined,
        ERROR_CODES.FIELD_NOT_EDITABLE
      );
    }

    // Resolve the caller's canonical DynamoDB userId. On the JWT fast path
    // user.userId is the Cognito sub, which may differ from the app userId,
    // so fall back to an email lookup when the record is not found by id.
    let record = await getUserById(user.userId);
    if (!record && user.email) {
      record = await getUserByEmail(user.email);
    }
    if (!record) {
      throw forbiddenError(
        'This user is not registered in the application.',
        undefined,
        ERROR_CODES.USER_NOT_REGISTERED
      );
    }

    const updatedUser = await updateUserProfile({
      actor: { userId: record.userId, role: user.role },
      targetUserId: record.userId,
      fields: {
        displayName: body.displayName as string | undefined,
        email: body.email as string | undefined,
        preferredLanguage: body.preferredLanguage as 'ja' | 'en' | undefined,
      },
    });

    return successResponse({ data: updatedUser });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw validationError(
      'The request body is not valid JSON.',
      undefined,
      ERROR_CODES.REQUEST_BODY_INVALID
    );
  }
}
