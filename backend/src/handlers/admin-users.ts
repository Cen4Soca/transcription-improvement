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
  getAllUsers,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  type UpdateUserInput,
} from '../repositories/user-repository.js';
import {
  createCognitoUser,
  disableCognitoUser,
  enableCognitoUser,
  globalSignOutCognitoUser,
  updateCognitoUserRole,
} from '../services/cognito-service.js';
import { recordAuditLog } from '../services/audit-service.js';
import { updateUserProfile } from '../services/user-service.js';

const VALID_ROLES = ['REVIEWER', 'TEAM_LEADER', 'ADMIN'] as const;
type ValidRole = (typeof VALID_ROLES)[number];

/**
 * GET /admin/users
 *
 * Retrieves all registered users. Admin only.
 *
 * Response:
 *   { data: UserRecord[] }
 */
export async function listUsersHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const users = await getAllUsers();
    return successResponse({ data: users });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

/**
 * POST /admin/users
 *
 * Creates a new user with the specified role.
 * Registers the user in both DynamoDB and Cognito.
 *
 * Request body:
 *   { email: string, displayName: string, role: "REVIEWER" | "TEAM_LEADER" | "ADMIN" }
 *
 * Response:
 *   { data: UserRecord }
 */
export async function createUserHandler(
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

    if (!body.displayName || typeof body.displayName !== 'string') {
      throw validationError(
        'Display name is required.',
        undefined,
        ERROR_CODES.DISPLAY_NAME_REQUIRED
      );
    }

    if (!body.role || !isValidRole(body.role)) {
      throw validationError(
        'Role must be one of REVIEWER, TEAM_LEADER, or ADMIN.',
        undefined,
        ERROR_CODES.ROLE_INVALID
      );
    }

    // Normalize email consistently with the sync path (admin-sync-user.ts).
    const email = body.email.trim().toLowerCase();
    const displayName = body.displayName.trim();

    // Check if email already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      throw validationError(
        'This email is already registered.',
        undefined,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED
      );
    }

    const userId = uuidv4();

    // Create user in Cognito first
    try {
      await createCognitoUser({
        email,
        displayName,
        role: body.role,
      });
    } catch (cognitoError: unknown) {
      throw internalError(
        'Failed to register the user in Cognito.',
        cognitoError instanceof Error ? cognitoError.message : undefined,
        ERROR_CODES.COGNITO_USER_REGISTRATION_FAILED
      );
    }

    // Create user in DynamoDB
    try {
      const newUser = await createUser({
        userId,
        email,
        displayName,
        role: body.role,
      });

      // Record audit log for user creation
      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'USER_MANAGEMENT',
        resourceId: userId,
        resourceType: 'User',
        metadata: {
          reason: 'User created',
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

/**
 * PATCH /admin/users/{userId}
 *
 * Updates a user's role and/or active status.
 * When isActive is set to false:
 *   - Calls Cognito AdminUserGlobalSignOut to invalidate existing sessions
 *   - Calls Cognito AdminDisableUser to prevent login
 * When isActive is set to true for a currently disabled user:
 *   - Calls Cognito AdminEnableUser to allow login again
 *
 * Request body:
 *   { role?: "REVIEWER" | "TEAM_LEADER" | "ADMIN", isActive?: boolean }
 *
 * Response:
 *   { data: UserRecord }
 */
export async function updateUserHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    requireRole(user, 'ADMIN');

    const userId = event.pathParameters?.userId;
    if (!userId) {
      throw validationError(
        'User ID is required.',
        undefined,
        ERROR_CODES.USER_ID_REQUIRED
      );
    }

    const body = parseBody(event.body);

    if (body.role !== undefined && !isValidRole(body.role)) {
      throw validationError(
        'Role must be one of REVIEWER, TEAM_LEADER, or ADMIN.',
        undefined,
        ERROR_CODES.ROLE_INVALID
      );
    }

    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      throw validationError(
        'isActive must be a boolean.',
        undefined,
        ERROR_CODES.IS_ACTIVE_INVALID
      );
    }

    const hasProfileFields =
      body.displayName !== undefined || body.email !== undefined;

    if (
      body.role === undefined &&
      body.isActive === undefined &&
      !hasProfileFields
    ) {
      throw validationError(
        'Specify at least one field to update (role, isActive, displayName, or email).',
        undefined,
        ERROR_CODES.NO_UPDATE_FIELDS
      );
    }

    // Verify user exists
    const existingUser = await getUserById(userId);
    if (!existingUser) {
      throw notFoundError(
        'User not found',
        undefined,
        ERROR_CODES.USER_NOT_FOUND
      );
    }

    // Handle user disable (Req 9.6)
    if (body.isActive === false) {
      try {
        // Invalidate existing sessions immediately
        await globalSignOutCognitoUser(existingUser.email);
        // Disable user to prevent future logins
        await disableCognitoUser(existingUser.email);
      } catch (cognitoError: unknown) {
        throw internalError(
          'Failed to deactivate the user.',
          cognitoError instanceof Error ? cognitoError.message : undefined,
          ERROR_CODES.USER_DEACTIVATION_FAILED
        );
      }
    }

    // Handle user re-enable: only when reactivating a currently disabled user.
    const isReactivating = body.isActive === true && existingUser.isActive === false;
    if (isReactivating) {
      try {
        // Enable the Cognito account so the user can log in again
        await enableCognitoUser(existingUser.email);
      } catch (cognitoError: unknown) {
        throw internalError(
          'Failed to activate the user.',
          cognitoError instanceof Error ? cognitoError.message : undefined,
          ERROR_CODES.USER_ACTIVATION_FAILED
        );
      }
    }

    // Handle role change via AdminUpdateUserAttributes (Req 14.18)
    if (body.role !== undefined && body.role !== existingUser.role) {
      try {
        await updateCognitoUserRole(
          existingUser.email,
          body.role as 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN'
        );
      } catch (cognitoError: unknown) {
        throw internalError(
          'Failed to change the role.',
          cognitoError instanceof Error ? cognitoError.message : undefined,
          ERROR_CODES.ROLE_UPDATE_FAILED
        );
      }
    }

    // Update role/isActive in DynamoDB (if requested)
    let updatedUser = existingUser;
    if (body.role !== undefined || body.isActive !== undefined) {
      try {
        updatedUser = await updateUser(userId, {
          role: body.role as UpdateUserInput['role'],
          isActive: body.isActive as UpdateUserInput['isActive'],
        });

        // Record audit log for user update
        await recordAuditLog({
          actorUserId: user.userId,
          actorRole: user.role,
          operationType: 'USER_MANAGEMENT',
          resourceId: userId,
          resourceType: 'User',
          metadata: {
            reason:
              body.isActive === false
                ? 'User deactivated'
                : isReactivating
                  ? 'User reactivated'
                  : 'User updated',
            ...(body.role !== undefined && { newValue: body.role as string }),
            ...(body.role !== undefined && existingUser.role !== body.role && { previousValue: existingUser.role }),
          },
        });
      } catch (dbError: unknown) {
        throw internalError(
          'Failed to update the user information.',
          dbError instanceof Error ? dbError.message : undefined,
          ERROR_CODES.USER_UPDATE_FAILED
        );
      }
    }

    // Update profile fields (displayName/email) via the shared service,
    // which handles email uniqueness, Cognito sync, and audit logging.
    if (hasProfileFields) {
      updatedUser = await updateUserProfile({
        actor: { userId: user.userId, role: user.role },
        targetUserId: userId,
        fields: {
          displayName: body.displayName as string | undefined,
          email: body.email as string | undefined,
        },
      });
    }

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

function isValidRole(role: unknown): role is ValidRole {
  return typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role);
}
