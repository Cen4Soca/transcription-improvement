/**
 * User Service
 *
 * Business logic for user profile management. Orchestrates the user
 * repository, Cognito, and the audit log so that both the admin user-edit
 * endpoint and the self-profile endpoint share a single, consistent flow.
 */

import {
  getUserById,
  getUserByEmail,
  updateUser,
  type UserRecord,
} from '../repositories/user-repository.js';
import { updateCognitoUserAttributes } from './cognito-service.js';
import { recordAuditLog } from './audit-service.js';
import {
  validationError,
  notFoundError,
  internalError,
} from '../utils/error-handler.js';
import type { UserRole } from '../utils/auth-middleware.js';

// Basic RFC-5322-ish email shape check. Full validation is delegated to Cognito.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPLAY_NAME_MAX_LENGTH = 100;

export interface ProfileUpdateFields {
  displayName?: string;
  email?: string;
}

export interface UpdateUserProfileParams {
  /** The user performing the update (for the audit log). */
  actor: { userId: string; role: UserRole };
  /** The user whose profile is being updated. */
  targetUserId: string;
  /** The fields to update. */
  fields: ProfileUpdateFields;
}

/**
 * Validate and normalize profile update fields.
 * Throws validationError if no valid field is provided or a value is invalid.
 * Returns the normalized fields (email lowercased/trimmed, displayName trimmed).
 */
export function validateProfileFields(fields: ProfileUpdateFields): ProfileUpdateFields {
  const normalized: ProfileUpdateFields = {};

  if (fields.displayName !== undefined) {
    if (typeof fields.displayName !== 'string') {
      throw validationError('表示名は文字列で指定してください。');
    }
    const trimmed = fields.displayName.trim();
    if (trimmed.length === 0) {
      throw validationError('表示名を入力してください。');
    }
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      throw validationError('表示名は100文字以内で入力してください。');
    }
    normalized.displayName = trimmed;
  }

  if (fields.email !== undefined) {
    if (typeof fields.email !== 'string') {
      throw validationError('メールアドレスは文字列で指定してください。');
    }
    const trimmed = fields.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(trimmed)) {
      throw validationError('メールアドレスの形式が正しくありません。');
    }
    normalized.email = trimmed;
  }

  if (normalized.displayName === undefined && normalized.email === undefined) {
    throw validationError('更新するフィールド（displayName または email）を指定してください。');
  }

  return normalized;
}

/**
 * Update a user's profile (display name and/or email).
 *
 * Flow:
 *   1. Validate & normalize the requested fields.
 *   2. Load the target user (404 if missing).
 *   3. If email changes, ensure it is not already used by another user.
 *   4. Update Cognito attributes (source of the JWT claims).
 *   5. Update DynamoDB (incl. GSI1PK when email changes).
 *   6. Record an audit log entry.
 *
 * Used by both the admin endpoint (PATCH /admin/users/{userId}) and the
 * self endpoint (PATCH /me).
 */
export async function updateUserProfile(
  params: UpdateUserProfileParams
): Promise<UserRecord> {
  const { actor, targetUserId, fields } = params;

  const normalized = validateProfileFields(fields);

  const existingUser = await getUserById(targetUserId);
  if (!existingUser) {
    throw notFoundError('指定されたユーザーが見つかりません。');
  }

  const emailChanged =
    normalized.email !== undefined && normalized.email !== existingUser.email;

  // Ensure the new email is not already taken by a different user.
  if (emailChanged) {
    const userWithEmail = await getUserByEmail(normalized.email as string);
    if (userWithEmail && userWithEmail.userId !== existingUser.userId) {
      throw validationError('このメールアドレスは既に使用されています。');
    }
  }

  const displayNameChanged =
    normalized.displayName !== undefined &&
    normalized.displayName !== existingUser.displayName;

  // Nothing actually changed — return the existing record without side effects.
  if (!emailChanged && !displayNameChanged) {
    return existingUser;
  }

  // Sync Cognito first. The current email is the Cognito Username.
  try {
    await updateCognitoUserAttributes(existingUser.email, {
      ...(displayNameChanged ? { displayName: normalized.displayName } : {}),
      ...(emailChanged ? { email: normalized.email } : {}),
    });
  } catch (cognitoError: unknown) {
    throw internalError(
      'プロファイルの更新に失敗しました。',
      cognitoError instanceof Error ? cognitoError.message : undefined
    );
  }

  // Persist to DynamoDB.
  let updatedUser: UserRecord;
  try {
    updatedUser = await updateUser(targetUserId, {
      ...(displayNameChanged ? { displayName: normalized.displayName } : {}),
      ...(emailChanged ? { email: normalized.email } : {}),
    });
  } catch (dbError: unknown) {
    throw internalError(
      'プロファイルの更新に失敗しました。',
      dbError instanceof Error ? dbError.message : undefined
    );
  }

  // Audit log (Req: all write operations recorded).
  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    operationType: 'USER_MANAGEMENT',
    resourceId: targetUserId,
    resourceType: 'User',
    metadata: {
      reason:
        actor.userId === targetUserId ? 'Profile self-updated' : 'Profile updated by admin',
      ...(displayNameChanged && {
        previousValue: existingUser.displayName,
        newValue: normalized.displayName as string,
      }),
      ...(emailChanged && {
        previousEmail: existingUser.email,
        newEmail: normalized.email as string,
      }),
    },
  });

  return updatedUser;
}
