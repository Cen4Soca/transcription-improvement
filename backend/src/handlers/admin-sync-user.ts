import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, notFoundError, internalError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import {
  getUserByEmail,
  createUser,
} from '../repositories/user-repository.js';
import { lookupCognitoUser } from '../services/cognito-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const VALID_ROLES = ['REVIEWER', 'TEAM_LEADER', 'ADMIN'] as const;
type ValidRole = (typeof VALID_ROLES)[number];

/**
 * POST /admin/users/sync
 *
 * Syncs an existing Cognito User Pool user into the application's DynamoDB table.
 * Does NOT create or modify the Cognito user — read-only lookup.
 *
 * Use case: A user already exists in the shared Cognito User Pool (e.g. registered
 * by another application) and needs to be registered in this app without touching
 * Cognito attributes.
 *
 * Request body:
 *   { email: string, role: "REVIEWER" | "TEAM_LEADER" | "ADMIN", displayName?: string }
 *
 * Behavior:
 *   1. Verifies the user exists in Cognito (AdminGetUser)
 *   2. Checks no DynamoDB record already exists for this email
 *   3. Creates a DynamoDB user record
 *
 * Response:
 *   { data: UserRecord }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const body = parseBody(event.body);

    if (!body.email || typeof body.email !== 'string') {
      throw validationError(
        'Email is required.',
        undefined,
        ERROR_CODES.EMAIL_REQUIRED
      );
    }

    if (!body.role || !isValidRole(body.role)) {
      throw validationError(
        'Role must be one of REVIEWER, TEAM_LEADER, or ADMIN.',
        undefined,
        ERROR_CODES.ROLE_INVALID
      );
    }

    const email = body.email.trim().toLowerCase();

    // 1. Check if user already registered in DynamoDB
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      throw validationError(
        'This email is already registered in the app.',
        undefined,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED
      );
    }

    // 2. Verify user exists in Cognito (read-only)
    const cognitoUser = await lookupCognitoUser(email);
    if (!cognitoUser) {
      throw notFoundError(
        'No user with the specified email was found in the Cognito user pool.',
        undefined,
        ERROR_CODES.COGNITO_USER_NOT_FOUND
      );
    }

    // 3. Determine display name: provided > Cognito attribute > email prefix
    const displayName =
      (body.displayName && typeof body.displayName === 'string'
        ? body.displayName.trim()
        : null) ||
      cognitoUser.displayName ||
      email.split('@')[0];

    // 4. Create user in DynamoDB only
    const userId = uuidv4();

    try {
      const newUser = await createUser({
        userId,
        email,
        displayName,
        role: body.role as ValidRole,
      });

      // 5. Record audit log
      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'USER_MANAGEMENT',
        resourceId: userId,
        resourceType: 'User',
        metadata: {
          reason: 'User synced from Cognito',
          resourceName: email,
        },
      });

      return successResponse({ data: newUser }, 201);
    } catch (dbError: unknown) {
      throw internalError(
        'Failed to register the user.',
        dbError instanceof Error ? dbError.message : undefined,
        ERROR_CODES.USER_REGISTRATION_FAILED
      );
    }
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

function isValidRole(role: unknown): role is ValidRole {
  return typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role);
}
