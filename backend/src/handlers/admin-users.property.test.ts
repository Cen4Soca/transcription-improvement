import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { updateUserHandler } from './admin-users.js';

// Mock identity resolution the same way admin-users.test.ts does: reproduce
// claim-based extraction so the handler always sees an ADMIN actor.
vi.mock('../utils/auth-middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/auth-middleware.js')>();
  const { forbiddenError } = await import('../utils/error-handler.js');
  return {
    ...actual,
    extractUser: vi.fn(async (event: any) => {
      const claims = event.requestContext.authorizer.jwt.claims;
      const sub = (claims['sub'] as string) ?? '';
      if (!sub) {
        throw forbiddenError('Authentication information is invalid.', 'Missing sub claim in JWT');
      }
      const role = (claims['custom:role'] as string) || 'REVIEWER';
      return {
        userId: sub,
        email: (claims['email'] as string) ?? '',
        displayName: (claims['custom:displayName'] as string) ?? '',
        role,
      };
    }),
  };
});

vi.mock('../repositories/user-repository.js', () => ({
  getAllUsers: vi.fn(),
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../services/cognito-service.js', () => ({
  createCognitoUser: vi.fn(),
  disableCognitoUser: vi.fn(),
  enableCognitoUser: vi.fn(),
  globalSignOutCognitoUser: vi.fn(),
  updateCognitoUserRole: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

vi.mock('../services/user-service.js', () => ({
  updateUserProfile: vi.fn(),
}));

import { getUserById, updateUser } from '../repositories/user-repository.js';
import {
  disableCognitoUser,
  enableCognitoUser,
  globalSignOutCognitoUser,
  updateCognitoUserRole,
} from '../services/cognito-service.js';
import { updateUserProfile } from '../services/user-service.js';

const mockedGetUserById = vi.mocked(getUserById);
const mockedUpdateUser = vi.mocked(updateUser);
const mockedDisableCognitoUser = vi.mocked(disableCognitoUser);
const mockedEnableCognitoUser = vi.mocked(enableCognitoUser);
const mockedGlobalSignOutCognitoUser = vi.mocked(globalSignOutCognitoUser);
const mockedUpdateCognitoUserRole = vi.mocked(updateCognitoUserRole);
const mockedUpdateUserProfile = vi.mocked(updateUserProfile);

type Role = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';

const TARGET_USER_ID = 'user-001';
const TARGET_EMAIL = 'reviewer@example.com';

function existingUserWithRole(role: Role) {
  return {
    userId: TARGET_USER_ID,
    email: TARGET_EMAIL,
    displayName: 'Reviewer One',
    role,
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function createPatchEvent(body: Record<string, unknown>): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: `PATCH /admin/users/${TARGET_USER_ID}`,
    rawPath: `/admin/users/${TARGET_USER_ID}`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: undefined,
    pathParameters: { userId: TARGET_USER_ID },
    body: JSON.stringify(body),
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: 'admin-001',
            email: 'admin@example.com',
            'custom:role': 'ADMIN',
            'custom:displayName': 'Admin User',
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'PATCH',
        path: `/admin/users/${TARGET_USER_ID}`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: `PATCH /admin/users/${TARGET_USER_ID}`,
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

/**
 * Feature: role-change-session-invalidation, Property 1: Bug Condition - role change session invalidation
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1**
 *
 * Bug condition: isBugCondition(X) = body.role !== undefined && body.role !== existingUser.role
 * (isActive unchanged). When an ADMIN changes a target user's role to a different value,
 * the system MUST force sign-out the target's existing sessions by calling
 * globalSignOutCognitoUser(existingUser.email) — regardless of promotion or demotion.
 *
 * This test encodes the EXPECTED (fixed) behavior. On the UNFIXED code the role-change
 * branch only calls updateCognitoUserRole + updateUser and never calls
 * globalSignOutCognitoUser, so this test is EXPECTED TO FAIL (call count 0). The failure
 * surfaces the counterexample that proves the bug exists.
 */
describe('Feature: role-change-session-invalidation, Property 1: Bug Condition - role change session invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const roleArb = fc.constantFrom<Role>('REVIEWER', 'TEAM_LEADER', 'ADMIN');

  it('forces a single global sign-out of the target user whenever the role actually changes (promotion or demotion)', async () => {
    await fc.assert(
      fc.asyncProperty(roleArb, roleArb, async (existingRole, newRole) => {
        // Constrain to the bug condition input space: role actually changes.
        fc.pre(newRole !== existingRole);

        vi.clearAllMocks();

        mockedGetUserById.mockResolvedValue(existingUserWithRole(existingRole));
        mockedUpdateCognitoUserRole.mockResolvedValue(undefined);
        mockedGlobalSignOutCognitoUser.mockResolvedValue(undefined);
        mockedUpdateUser.mockResolvedValue({
          ...existingUserWithRole(existingRole),
          role: newRole,
          updatedAt: '2024-01-15T00:00:00.000Z',
        });

        // Pure role change: isActive is NOT specified.
        const event = createPatchEvent({ role: newRole });
        const result = await updateUserHandler(event);

        expect(result.statusCode).toBe(200);

        // Expected (fixed) behavior — the role change must invalidate existing sessions.
        expect(mockedGlobalSignOutCognitoUser).toHaveBeenCalledTimes(1);
        expect(mockedGlobalSignOutCognitoUser).toHaveBeenCalledWith(TARGET_EMAIL);

        // Preserved behaviors that already exist on the role-change path.
        expect(mockedUpdateCognitoUserRole).toHaveBeenCalledWith(TARGET_EMAIL, newRole);
        expect(mockedUpdateUser).toHaveBeenCalledWith(
          TARGET_USER_ID,
          expect.objectContaining({ role: newRole })
        );

        // Pure role change must not trigger the deactivation flow.
        expect(mockedDisableCognitoUser).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: role-change-session-invalidation, Property 2: Preservation - non-role-change behavior preserved
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 *
 * Observation-first: these baselines were recorded against the UNFIXED updateUserHandler (F)
 * and must stay identical after the fix (F'), because they all fall outside the bug condition
 * (isBugCondition(X) = body.role !== undefined && body.role !== existingUser.role).
 *
 * Observed baselines on F:
 *   - Role unchanged (body.role unspecified OR body.role === existingUser.role) with no
 *     deactivation → globalSignOutCognitoUser call count 0 (3.1).
 *   - Deactivation (body.isActive === false) → globalSignOutCognitoUser 1 call +
 *     disableCognitoUser 1 call, on the target email (3.2). This path already signs out on F,
 *     so it must keep doing exactly that on F'.
 *   - Deactivation + simultaneous role change (body = { role: <different>, isActive: false }) →
 *     globalSignOutCognitoUser exactly 1 call (never double) — the baseline the fix must not
 *     break into a double sign-out (3.2).
 *   - Profile-only update (body = { displayName } / { email }) → routed through
 *     updateUserProfile, globalSignOutCognitoUser call count 0 (3.3).
 *   - Shared-pool fallback: updateCognitoUserRole swallowing an undefined custom:role does not
 *     change the non-role-change paths observed here (3.4).
 */
describe('Feature: role-change-session-invalidation, Property 2: Preservation - non-role-change behavior preserved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const roleArb = fc.constantFrom<Role>('REVIEWER', 'TEAM_LEADER', 'ADMIN');

  /**
   * **Validates: Requirements 3.1, 3.4**
   *
   * Role-unchanged updates (role unspecified, or role === existing role) without deactivation
   * never force a sign-out. Covers isActive toggles and same-role re-specification across the
   * full role space, for both dedicated and shared User Pool configurations (the handler path
   * is identical; updateCognitoUserRole is not even reached when the role does not change).
   */
  it('never signs out when the role does not actually change (role unspecified or identical)', async () => {
    const bodyArb = fc
      .record({
        // Either omit role entirely, or set it to the SAME role (fc.pre keeps it identical).
        includeRole: fc.boolean(),
        sameRole: roleArb,
        // isActive: omitted, or true (false is the deactivation flow, covered separately).
        isActive: fc.option(fc.constant(true), { nil: undefined }),
      })
      .filter((b) => b.includeRole || b.isActive !== undefined);

    await fc.assert(
      fc.asyncProperty(roleArb, bodyArb, async (existingRole, b) => {
        // Non-bug input space: role is never changed to a different value.
        const sameRole = b.sameRole;
        const existing = b.includeRole ? sameRole : existingRole;

        vi.clearAllMocks();

        mockedGetUserById.mockResolvedValue({
          ...existingUserWithRole(existing),
          isActive: true,
        });
        mockedUpdateUser.mockResolvedValue({
          ...existingUserWithRole(existing),
          updatedAt: '2024-01-15T00:00:00.000Z',
        });

        const body: Record<string, unknown> = {};
        if (b.includeRole) {
          body.role = existing; // identical role → not a role change
        }
        if (b.isActive !== undefined) {
          body.isActive = b.isActive;
        }

        const event = createPatchEvent(body);
        const result = await updateUserHandler(event);

        expect(result.statusCode).toBe(200);

        // Baseline on F: no forced sign-out and no deactivation when the role is unchanged
        // and the user is not being deactivated.
        expect(mockedGlobalSignOutCognitoUser).not.toHaveBeenCalled();
        expect(mockedDisableCognitoUser).not.toHaveBeenCalled();
        // No actual role transition → Cognito role attribute is not touched.
        expect(mockedUpdateCognitoUserRole).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * The deactivation flow (body.isActive === false) keeps calling globalSignOutCognitoUser
   * exactly once plus disableCognitoUser exactly once on the target email — including when a
   * role change is requested in the same PATCH. This is the baseline the fix must not turn into
   * a double sign-out. Observed on F, must hold on F'.
   */
  it('keeps the deactivation flow at exactly one sign-out + one disable, even with a simultaneous role change', async () => {
    const includeRoleChangeArb = fc.boolean();

    await fc.assert(
      fc.asyncProperty(roleArb, roleArb, includeRoleChangeArb, async (existingRole, newRole, includeRoleChange) => {
        vi.clearAllMocks();

        mockedGetUserById.mockResolvedValue({
          ...existingUserWithRole(existingRole),
          isActive: true,
        });
        mockedGlobalSignOutCognitoUser.mockResolvedValue(undefined);
        mockedDisableCognitoUser.mockResolvedValue(undefined);
        mockedUpdateCognitoUserRole.mockResolvedValue(undefined);
        mockedUpdateUser.mockResolvedValue({
          ...existingUserWithRole(includeRoleChange ? newRole : existingRole),
          isActive: false,
          updatedAt: '2024-01-15T00:00:00.000Z',
        });

        const body: Record<string, unknown> = { isActive: false };
        // Optionally request a (possibly different) role in the same PATCH.
        if (includeRoleChange) {
          body.role = newRole;
        }

        const event = createPatchEvent(body);
        const result = await updateUserHandler(event);

        expect(result.statusCode).toBe(200);

        // Deactivation baseline: exactly one sign-out + exactly one disable, never doubled.
        expect(mockedGlobalSignOutCognitoUser).toHaveBeenCalledTimes(1);
        expect(mockedGlobalSignOutCognitoUser).toHaveBeenCalledWith(TARGET_EMAIL);
        expect(mockedDisableCognitoUser).toHaveBeenCalledTimes(1);
        expect(mockedDisableCognitoUser).toHaveBeenCalledWith(TARGET_EMAIL);
        // Re-enable must not fire while deactivating.
        expect(mockedEnableCognitoUser).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Profile-only updates (displayName and/or email, no role/isActive) are delegated to
   * updateUserProfile and never force a sign-out. Observed on F, must hold on F'.
   */
  it('routes profile-only updates through updateUserProfile without signing out', async () => {
    const profileBodyArb = fc
      .record({
        displayName: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
        email: fc.option(
          fc.string({ minLength: 1, maxLength: 20 }).map((s) => `${s.replace(/\s/g, '')}@example.com`),
          { nil: undefined }
        ),
      })
      // Must contain at least one profile field, and no role/isActive.
      .filter((b) => b.displayName !== undefined || b.email !== undefined);

    await fc.assert(
      fc.asyncProperty(roleArb, profileBodyArb, async (existingRole, profile) => {
        vi.clearAllMocks();

        mockedGetUserById.mockResolvedValue(existingUserWithRole(existingRole));
        mockedUpdateUserProfile.mockResolvedValue({
          ...existingUserWithRole(existingRole),
          ...(profile.displayName !== undefined && { displayName: profile.displayName }),
          ...(profile.email !== undefined && { email: profile.email }),
          updatedAt: '2024-01-15T00:00:00.000Z',
        });

        const body: Record<string, unknown> = {};
        if (profile.displayName !== undefined) {
          body.displayName = profile.displayName;
        }
        if (profile.email !== undefined) {
          body.email = profile.email;
        }

        const event = createPatchEvent(body);
        const result = await updateUserHandler(event);

        expect(result.statusCode).toBe(200);

        // Profile-only path delegates to the shared service and never signs out.
        expect(mockedUpdateUserProfile).toHaveBeenCalledTimes(1);
        expect(mockedGlobalSignOutCognitoUser).not.toHaveBeenCalled();
        expect(mockedDisableCognitoUser).not.toHaveBeenCalled();
        expect(mockedUpdateCognitoUserRole).not.toHaveBeenCalled();
        // role/isActive are untouched, so the role/isActive DynamoDB branch is not taken.
        expect(mockedUpdateUser).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
