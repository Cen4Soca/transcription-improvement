import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { extractUser, requireRole, hasMinimumRole, type UserRole } from './auth-middleware.js';

vi.mock('../repositories/user-repository.js', () => ({
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
}));

const ALL_ROLES: UserRole[] = ['REVIEWER', 'TEAM_LEADER', 'ADMIN'];

const ROLE_HIERARCHY: Record<UserRole, number> = {
  REVIEWER: 1,
  TEAM_LEADER: 2,
  ADMIN: 3,
};

function createMockEvent(claims: Record<string, string>): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims,
          scopes: [],
        },
      },
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.execute-api.ap-northeast-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: '/test',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-request-id',
      routeKey: 'GET /test',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    headers: {},
    isBase64Encoded: false,
    rawPath: '/test',
    rawQueryString: '',
    routeKey: 'GET /test',
    version: '2.0',
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('Feature: auth-middleware, Property 44: custom:role 属性の不変性', () => {
  /**
   * **Validates: Requirements 14.18**
   *
   * For any user with any role (REVIEWER, TEAM_LEADER, ADMIN), the extractUser function
   * always returns the role from JWT claims without modification, and requireRole correctly
   * enforces the hierarchy (ADMIN >= TEAM_LEADER >= REVIEWER).
   */
  it('role extracted from JWT claims is immutable and hierarchy is consistently enforced', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          email: fc.emailAddress(),
          displayName: fc.string({ minLength: 1, maxLength: 50 }),
          role: fc.constantFrom(...ALL_ROLES),
        }),
        fc.constantFrom(...ALL_ROLES),
        async ({ userId, email, displayName, role }, requiredRole) => {
          // Part 1: extractUser returns the role from JWT claims without modification
          const event = createMockEvent({
            sub: userId,
            email,
            'custom:displayName': displayName,
            'custom:role': role,
          });

          const user = await extractUser(event);

          // The role must be exactly what was in the JWT claims - no modification allowed
          expect(user.role).toBe(role);
          expect(user.userId).toBe(userId);
          expect(user.email).toBe(email);

          // Part 2: requireRole consistently enforces the hierarchy
          const userLevel = ROLE_HIERARCHY[user.role];
          const requiredLevel = ROLE_HIERARCHY[requiredRole];

          if (userLevel >= requiredLevel) {
            // User has sufficient privileges - requireRole should NOT throw
            expect(() => requireRole(user, requiredRole)).not.toThrow();
          } else {
            // User lacks privileges - requireRole MUST throw
            expect(() => requireRole(user, requiredRole)).toThrow();
          }

          // Part 3: Verify hierarchy consistency (ADMIN >= TEAM_LEADER >= REVIEWER)
          expect(hasMinimumRole('ADMIN', 'ADMIN')).toBe(true);
          expect(hasMinimumRole('ADMIN', 'TEAM_LEADER')).toBe(true);
          expect(hasMinimumRole('ADMIN', 'REVIEWER')).toBe(true);
          expect(hasMinimumRole('TEAM_LEADER', 'TEAM_LEADER')).toBe(true);
          expect(hasMinimumRole('TEAM_LEADER', 'REVIEWER')).toBe(true);
          expect(hasMinimumRole('TEAM_LEADER', 'ADMIN')).toBe(false);
          expect(hasMinimumRole('REVIEWER', 'REVIEWER')).toBe(true);
          expect(hasMinimumRole('REVIEWER', 'TEAM_LEADER')).toBe(false);
          expect(hasMinimumRole('REVIEWER', 'ADMIN')).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
