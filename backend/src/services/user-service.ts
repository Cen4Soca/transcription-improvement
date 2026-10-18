/**
 * User Service
 *
 * Business logic for user profile management. Orchestrates the user
 * repository, Cognito, and the audit log so that both the admin user-edit
 * endpoint and the self-profile endpoint share a single, consistent flow.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  getUserById,
  getUserByEmail,
  createUser,
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

const JIT_DEFAULT_ROLE: UserRole = 'REVIEWER';

export interface ProvisionUserParams {
  /** Cognito email claim (will be normalized: trimmed + lowercased). */
  email: string;
  /** Optional display name from the JWT custom:displayName claim. */
  displayName?: string;
}

/**
 * Just-in-time (JIT) user provisioning.
 *
 * When a user authenticates through the shared Cognito User Pool but has no
 * DynamoDB user record yet (e.g. they were registered in another app that
 * shares the pool, such as GenU), auto-create a record on their first
 * authenticated request instead of rejecting them.
 *
 * Decided parameters (do not change without a product decision):
 *   - Role is always REVIEWER. Elevated roles are never auto-assigned.
 *   - No team membership is created.
 *   - Anyone who can authenticate with the shared pool may self-provision.
 *
 * Idempotency / concurrency:
 *   Each request would generate a fresh userId UUID, so the repository's
 *   attribute_not_exists(PK) guard cannot catch an email-level race on its own.
 *   We therefore use a check-then-create-then-reread pattern:
 *     1. getUserByEmail — if a record already exists, return it.
 *     2. Otherwise attempt createUser.
 *     3. If createUser fails (e.g. ConditionalCheckFailedException), or to be
 *        safe after a lost race, re-read by email and return that record.
 *   There is no email-level uniqueness constraint in DynamoDB, so a residual
 *   race where two requests both create a record is possible but bounded and
 *   self-healing: every subsequent getUserByEmail (Limit: 1) resolves to a
 *   single usable record, and no request throws.
 *
 * An AuditLog entry is written for the auto-creation. An audit-write failure
 * must NOT block login — the user is already provisioned — so it is logged as
 * a warning and swallowed.
 */
export async function provisionUserOnFirstLogin(
  params: ProvisionUserParams
): Promise<UserRecord> {
  const email = params.email.trim().toLowerCase();

  // 1. If the user already exists, reuse it (idempotent on repeat calls).
  const existing = await getUserByEmail(email);
  if (existing) {
    return existing;
  }

  const displayName =
    (params.displayName && typeof params.displayName === 'string'
      ? params.displayName.trim()
      : '') || email.split('@')[0];

  const userId = uuidv4();

  // 2. Attempt to create. On a concurrent-create race the PK guard (or a lost
  //    email race) means someone else won — fall back to the existing record.
  let newUser: UserRecord;
  try {
    newUser = await createUser({
      userId,
      email,
      displayName,
      role: JIT_DEFAULT_ROLE,
    });
  } catch {
    // 3. Re-read: a concurrent request created the record first.
    const raced = await getUserByEmail(email);
    if (raced) {
      return raced;
    }
    // No record and create failed for another reason — surface as 500.
    throw internalError('ユーザーの自動登録に失敗しました。');
  }

  // Audit the auto-provision. Never let an audit failure block login.
  try {
    await recordAuditLog({
      actorUserId: newUser.userId,
      actorRole: newUser.role,
      operationType: 'USER_AUTO_PROVISIONED',
      resourceId: newUser.userId,
      resourceType: 'User',
      metadata: {
        reason: 'User auto-provisioned on first login (JIT)',
        resourceName: email,
      },
    });
  } catch (auditError: unknown) {
    console.warn(
      'Failed to record audit log for JIT user provisioning:',
      auditError instanceof Error ? auditError.message : auditError
    );
  }

  return newUser;
}
