import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';

/**
 * GET /me
 * Returns the current authenticated user's profile from DynamoDB.
 * Used by the frontend to determine the user's role and display name
 * since the shared Cognito User Pool does not include custom:role claims.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    return successResponse({
      data: {
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
