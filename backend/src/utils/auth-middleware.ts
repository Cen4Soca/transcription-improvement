import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { forbiddenError, notFoundError } from './error-handler.js';
import { getUserByEmail } from '../repositories/user-repository.js';
import { provisionUserOnFirstLogin } from '../services/user-service.js';

export type UserRole = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  REVIEWER: 1,
  TEAM_LEADER: 2,
  ADMIN: 3,
};

/**
 * Extract authenticated user information from API Gateway JWT Authorizer claims
 * and resolve the role from DynamoDB user record.
 *
 * JWT is pre-validated by API Gateway; Lambda receives verified claims.
 *
 * Identity resolution: the user is ALWAYS resolved to its canonical DynamoDB
 * user record (keyed by a uuidv4 userId) by email. AuthUser.userId is that
 * canonical userId — never the Cognito `sub` claim — because access-control
 * records (ReviewAssignment, TeamMembership) are keyed on the canonical userId.
 * Using `sub` here caused non-ADMIN users with legitimate assignments to be
 * denied access (404).
 *
 * Role determination:
 *   1. If JWT contains a valid custom:role claim → use it (dedicated User Pool)
 *   2. Otherwise → use the role on the DynamoDB record (shared User Pool)
 * If no record exists, the user is auto-provisioned just-in-time (JIT) as a
 * REVIEWER (see provisionUserOnFirstLogin).
 */
export async function extractUser(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<AuthUser> {
  const claims = event.requestContext.authorizer.jwt.claims;

  const sub = (claims['sub'] as string) ?? '';
  const email = (claims['email'] as string) ?? '';
  const jwtRole = (claims['custom:role'] as string) ?? '';

  if (!sub) {
    throw forbiddenError('認証情報が不正です。', 'Missing sub claim in JWT');
  }

  // Email is required to resolve the canonical DynamoDB user record.
  if (!email) {
    throw forbiddenError('認証情報が不正です。', 'Missing email claim in JWT');
  }

  const claimDisplayName = (claims['custom:displayName'] as string) ?? '';

  // Resolve the canonical DynamoDB user record by email. The record's userId
  // (a uuidv4 assigned at user creation) is the identifier used as the key for
  // ReviewAssignment / TeamMembership records. The Cognito `sub` claim is a
  // separate identifier and MUST NOT be used for access-control lookups, or
  // non-ADMIN users with legitimate assignments would be denied (404).
  let userRecord = await getUserByEmail(email);

  // JIT provisioning: a user authenticated via the shared Cognito User Pool but
  // has no DynamoDB record yet (e.g. registered in another app sharing the pool).
  // Auto-create a REVIEWER record on first login instead of rejecting them.
  if (!userRecord) {
    userRecord = await provisionUserOnFirstLogin({ email, displayName: claimDisplayName });
  }

  if (!userRecord.isActive) {
    throw forbiddenError(
      'アカウントが無効化されています。',
      `User deactivated: ${userRecord.userId}`
    );
  }

  // Role precedence: a valid custom:role claim (dedicated User Pool) wins;
  // otherwise fall back to the role stored in the DynamoDB record (shared pool).
  const role: UserRole = isValidRole(jwtRole) ? jwtRole : userRecord.role;

  return {
    userId: userRecord.userId,
    email: userRecord.email,
    displayName: userRecord.displayName || claimDisplayName,
    role,
  };
}

/**
 * Check if a given string is a valid UserRole.
 */
export function isValidRole(role: string): role is UserRole {
  return role === 'REVIEWER' || role === 'TEAM_LEADER' || role === 'ADMIN';
}

/**
 * Check if the user has at least the required role level.
 * Role hierarchy: ADMIN > TEAM_LEADER > REVIEWER
 */
export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Require a minimum role for an operation.
 * Throws 403 if the user does not have sufficient privileges.
 */
export function requireRole(user: AuthUser, requiredRole: UserRole): void {
  if (!hasMinimumRole(user.role, requiredRole)) {
    throw forbiddenError(
      'この操作を実行する権限がありません。',
      `Required role: ${requiredRole}, current role: ${user.role}`
    );
  }
}

/**
 * Deny access to a resource the user should not know exists.
 * Returns 404 to hide the existence of the resource.
 */
export function denyResourceAccess(): never {
  throw notFoundError('リソースが見つかりません。');
}

/**
 * Check if the user is an ADMIN (can access everything).
 */
export function isAdmin(user: AuthUser): boolean {
  return user.role === 'ADMIN';
}

/**
 * Check if the user is a TEAM_LEADER or higher.
 */
export function isTeamLeaderOrAbove(user: AuthUser): boolean {
  return hasMinimumRole(user.role, 'TEAM_LEADER');
}

/**
 * Check if the user account is active.
 * Note: extractUser() already performs this check. This function is retained
 * for cases where a fresh active-status check is needed after extractUser()
 * (e.g., long-running operations).
 *
 * Throws 403 if the user is deactivated.
 */
export async function checkUserActive(user: AuthUser): Promise<void> {
  const userRecord = await getUserByEmail(user.email);

  if (!userRecord) {
    throw forbiddenError(
      'ユーザーアカウントが見つかりません。',
      `User not found: ${user.email}`
    );
  }

  if (!userRecord.isActive) {
    throw forbiddenError(
      'アカウントが無効化されています。',
      `User deactivated: ${userRecord.userId}`
    );
  }
}
