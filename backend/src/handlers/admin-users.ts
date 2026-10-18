import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, notFoundError, internalError } from '../utils/error-handler.js';
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
      throw validationError('メールアドレスは必須です。');
    }

    if (!body.displayName || typeof body.displayName !== 'string') {
      throw validationError('表示名は必須です。');
    }

    if (!body.role || !isValidRole(body.role)) {
      throw validationError(
        'ロールは REVIEWER, TEAM_LEADER, ADMIN のいずれかを指定してください。'
      );
    }

    // Normalize email consistently with the sync path (admin-sync-user.ts).
    const email = body.email.trim().toLowerCase();
    const displayName = body.displayName.trim();

    // Check if email already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      throw validationError('このメールアドレスは既に登録されています。');
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
        'Cognito へのユーザー登録に失敗しました。',
        cognitoError instanceof Error ? cognitoError.message : undefined
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
        'ユーザーの登録に失敗しました。',
        dbError instanceof Error ? dbError.message : undefined
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
      throw validationError('ユーザーIDは必須です。');
    }

    const body = parseBody(event.body);

    if (body.role !== undefined && !isValidRole(body.role)) {
      throw validationError(
        'ロールは REVIEWER, TEAM_LEADER, ADMIN のいずれかを指定してください。'
      );
    }

    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      throw validationError('isActive は真偽値で指定してください。');
    }

    const hasProfileFields =
      body.displayName !== undefined || body.email !== undefined;

    if (
      body.role === undefined &&
      body.isActive === undefined &&
      !hasProfileFields
    ) {
      throw validationError(
        '更新するフィールド（role, isActive, displayName, email）を指定してください。'
      );
    }

    // Verify user exists
    const existingUser = await getUserById(userId);
    if (!existingUser) {
      throw notFoundError('指定されたユーザーが見つかりません。');
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
          'ユーザーの無効化処理に失敗しました。',
          cognitoError instanceof Error ? cognitoError.message : undefined
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
          'ユーザーの有効化処理に失敗しました。',
          cognitoError instanceof Error ? cognitoError.message : undefined
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
          'ロールの変更に失敗しました。',
          cognitoError instanceof Error ? cognitoError.message : undefined
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
          'ユーザー情報の更新に失敗しました。',
          dbError instanceof Error ? dbError.message : undefined
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
    throw validationError('リクエストボディのJSON形式が不正です。');
  }
}

function isValidRole(role: unknown): role is ValidRole {
  return typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role);
}
