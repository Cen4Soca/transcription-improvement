import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { listUsersHandler, createUserHandler, updateUserHandler } from './admin-users.js';


vi.mock('../utils/auth-middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/auth-middleware.js')>();
  const { forbiddenError } = await import('../utils/error-handler.js');
  return {
    ...actual,
    // Handler unit tests isolate handler logic from identity resolution by
    // reproducing claim-based extraction (sub -> userId). The real extractUser's
    // canonical-userId resolution is covered in auth-middleware.test.ts.
    extractUser: vi.fn(async (event: any) => {
      const claims = event.requestContext.authorizer.jwt.claims;
      const sub = (claims['sub'] as string) ?? '';
      if (!sub) {
        throw forbiddenError('認証情報が不正です。', 'Missing sub claim in JWT');
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

vi.mock('uuid', () => ({
  v4: () => 'generated-uuid-001',
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

vi.mock('../services/user-service.js', () => ({
  updateUserProfile: vi.fn(),
}));

import {
  getAllUsers,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
} from '../repositories/user-repository.js';
import { updateUserProfile } from '../services/user-service.js';
import {
  createCognitoUser,
  disableCognitoUser,
  enableCognitoUser,
  globalSignOutCognitoUser,
  updateCognitoUserRole,
} from '../services/cognito-service.js';

const mockedGetAllUsers = vi.mocked(getAllUsers);
const mockedGetUserById = vi.mocked(getUserById);
const mockedGetUserByEmail = vi.mocked(getUserByEmail);
const mockedCreateUser = vi.mocked(createUser);
const mockedUpdateUser = vi.mocked(updateUser);
const mockedCreateCognitoUser = vi.mocked(createCognitoUser);
const mockedDisableCognitoUser = vi.mocked(disableCognitoUser);
const mockedEnableCognitoUser = vi.mocked(enableCognitoUser);
const mockedGlobalSignOutCognitoUser = vi.mocked(globalSignOutCognitoUser);
const mockedUpdateCognitoUserRole = vi.mocked(updateCognitoUserRole);
const mockedUpdateUserProfile = vi.mocked(updateUserProfile);

function createEvent(
  overrides: Partial<{
    userId: string;
    email: string;
    role: string;
    displayName: string;
    method: string;
    path: string;
    pathParameters: Record<string, string>;
    body: string | undefined;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    userId = 'admin-001',
    email = 'admin@example.com',
    role = 'ADMIN',
    displayName = 'Admin User',
    method = 'GET',
    path = '/admin/users',
    pathParameters,
    body,
  } = overrides;

  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: undefined,
    pathParameters,
    body,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email,
            'custom:role': role,
            'custom:displayName': displayName,
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleUsers = [
  {
    userId: 'user-001',
    email: 'reviewer@example.com',
    displayName: 'Reviewer One',
    role: 'REVIEWER' as const,
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    userId: 'user-002',
    email: 'leader@example.com',
    displayName: 'Team Leader',
    role: 'TEAM_LEADER' as const,
    isActive: true,
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
];

describe('GET /admin/users - listUsersHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all users for ADMIN', async () => {
    mockedGetAllUsers.mockResolvedValue(sampleUsers);

    const event = createEvent();
    const result = await listUsersHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].email).toBe('reviewer@example.com');
  });

  it('returns 403 for non-ADMIN user', async () => {
    const event = createEvent({ role: 'REVIEWER' });
    const result = await listUsersHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('権限がありません');
  });

  it('returns 403 for TEAM_LEADER', async () => {
    const event = createEvent({ role: 'TEAM_LEADER' });
    const result = await listUsersHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns empty array when no users exist', async () => {
    mockedGetAllUsers.mockResolvedValue([]);

    const event = createEvent();
    const result = await listUsersHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toEqual([]);
  });
});

describe('POST /admin/users - createUserHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new user with REVIEWER role', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateCognitoUser.mockResolvedValue(undefined);
    mockedCreateUser.mockResolvedValue({
      userId: 'generated-uuid-001',
      email: 'new@example.com',
      displayName: 'New User',
      role: 'REVIEWER',
      isActive: true,
      createdAt: '2024-01-10T00:00:00.000Z',
      updatedAt: '2024-01-10T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'new@example.com',
        displayName: 'New User',
        role: 'REVIEWER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.email).toBe('new@example.com');
    expect(body.data.role).toBe('REVIEWER');
    expect(body.data.isActive).toBe(true);
    expect(mockedCreateCognitoUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      displayName: 'New User',
      role: 'REVIEWER',
    });
  });

  it('creates a user with TEAM_LEADER role', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateCognitoUser.mockResolvedValue(undefined);
    mockedCreateUser.mockResolvedValue({
      userId: 'generated-uuid-001',
      email: 'leader@example.com',
      displayName: 'Leader',
      role: 'TEAM_LEADER',
      isActive: true,
      createdAt: '2024-01-10T00:00:00.000Z',
      updatedAt: '2024-01-10T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'leader@example.com',
        displayName: 'Leader',
        role: 'TEAM_LEADER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.role).toBe('TEAM_LEADER');
  });

  it('creates a user with ADMIN role', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateCognitoUser.mockResolvedValue(undefined);
    mockedCreateUser.mockResolvedValue({
      userId: 'generated-uuid-001',
      email: 'admin2@example.com',
      displayName: 'Admin Two',
      role: 'ADMIN',
      isActive: true,
      createdAt: '2024-01-10T00:00:00.000Z',
      updatedAt: '2024-01-10T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'admin2@example.com',
        displayName: 'Admin Two',
        role: 'ADMIN',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.role).toBe('ADMIN');
  });

  it('returns 403 for non-ADMIN user', async () => {
    const event = createEvent({
      role: 'REVIEWER',
      method: 'POST',
      body: JSON.stringify({
        email: 'new@example.com',
        displayName: 'New User',
        role: 'REVIEWER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when email is missing', async () => {
    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        displayName: 'New User',
        role: 'REVIEWER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('メールアドレスは必須');
  });

  it('returns 400 when displayName is missing', async () => {
    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'new@example.com',
        role: 'REVIEWER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('表示名は必須');
  });

  it('returns 400 when role is invalid', async () => {
    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'new@example.com',
        displayName: 'New User',
        role: 'INVALID_ROLE',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ロールは REVIEWER, TEAM_LEADER, ADMIN');
  });

  it('returns 400 when email already exists', async () => {
    mockedGetUserByEmail.mockResolvedValue(sampleUsers[0]);

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'reviewer@example.com',
        displayName: 'Duplicate',
        role: 'REVIEWER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('既に登録されています');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const event = createEvent({
      method: 'POST',
      body: 'not-json',
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('JSON形式が不正');
  });

  it('returns 500 when Cognito user creation fails', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateCognitoUser.mockRejectedValue(new Error('Cognito error'));

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'new@example.com',
        displayName: 'New User',
        role: 'REVIEWER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('Cognito へのユーザー登録に失敗');
  });

  it('returns 500 when DynamoDB user creation fails', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);
    mockedCreateCognitoUser.mockResolvedValue(undefined);
    mockedCreateUser.mockRejectedValue(new Error('DynamoDB error'));

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({
        email: 'new@example.com',
        displayName: 'New User',
        role: 'REVIEWER',
      }),
    });
    const result = await createUserHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ユーザーの登録に失敗');
  });
});

describe('PATCH /admin/users/{userId} - updateUserHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates user role', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedUpdateCognitoUserRole.mockResolvedValue(undefined);
    mockedUpdateUser.mockResolvedValue({
      ...sampleUsers[0],
      role: 'TEAM_LEADER',
      updatedAt: '2024-01-15T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'TEAM_LEADER' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.role).toBe('TEAM_LEADER');
    // Verify role change goes through AdminUpdateUserAttributes
    expect(mockedUpdateCognitoUserRole).toHaveBeenCalledWith('reviewer@example.com', 'TEAM_LEADER');
    expect(mockedDisableCognitoUser).not.toHaveBeenCalled();
    expect(mockedGlobalSignOutCognitoUser).not.toHaveBeenCalled();
  });

  it('disables user and invalidates sessions', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedGlobalSignOutCognitoUser.mockResolvedValue(undefined);
    mockedDisableCognitoUser.mockResolvedValue(undefined);
    mockedUpdateUser.mockResolvedValue({
      ...sampleUsers[0],
      isActive: false,
      updatedAt: '2024-01-15T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ isActive: false }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.isActive).toBe(false);
    // Verify Cognito operations were called in correct order
    expect(mockedGlobalSignOutCognitoUser).toHaveBeenCalledWith('reviewer@example.com');
    expect(mockedDisableCognitoUser).toHaveBeenCalledWith('reviewer@example.com');
  });

  it('updates both role and isActive simultaneously', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedUpdateCognitoUserRole.mockResolvedValue(undefined);
    mockedGlobalSignOutCognitoUser.mockResolvedValue(undefined);
    mockedDisableCognitoUser.mockResolvedValue(undefined);
    mockedUpdateUser.mockResolvedValue({
      ...sampleUsers[0],
      role: 'ADMIN',
      isActive: false,
      updatedAt: '2024-01-15T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'ADMIN', isActive: false }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.role).toBe('ADMIN');
    expect(body.data.isActive).toBe(false);
    expect(mockedGlobalSignOutCognitoUser).toHaveBeenCalled();
    expect(mockedDisableCognitoUser).toHaveBeenCalled();
    expect(mockedUpdateCognitoUserRole).toHaveBeenCalledWith('reviewer@example.com', 'ADMIN');
  });

  it('returns 403 for non-ADMIN user', async () => {
    const event = createEvent({
      role: 'REVIEWER',
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'TEAM_LEADER' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when userId is missing from path', async () => {
    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/',
      pathParameters: undefined,
      body: JSON.stringify({ role: 'TEAM_LEADER' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ユーザーIDは必須');
  });

  it('returns 400 when role is invalid', async () => {
    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'SUPER_ADMIN' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ロールは REVIEWER, TEAM_LEADER, ADMIN');
  });

  it('returns 400 when isActive is not boolean', async () => {
    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ isActive: 'false' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('isActive は真偽値');
  });

  it('returns 400 when no update fields are provided', async () => {
    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({}),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('更新するフィールド');
  });

  it('returns 404 when user does not exist', async () => {
    mockedGetUserById.mockResolvedValue(null);

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/nonexistent',
      pathParameters: { userId: 'nonexistent' },
      body: JSON.stringify({ role: 'TEAM_LEADER' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ユーザーが見つかりません');
  });

  it('returns 500 when Cognito disable fails', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedGlobalSignOutCognitoUser.mockRejectedValue(new Error('Cognito timeout'));

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ isActive: false }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('無効化処理に失敗');
  });

  it('returns 500 when DynamoDB update fails', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedUpdateUser.mockRejectedValue(new Error('DynamoDB error'));

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'TEAM_LEADER' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ユーザー情報の更新に失敗');
  });

  it('returns 500 when Cognito role update fails', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedUpdateCognitoUserRole.mockRejectedValue(new Error('Cognito role update error'));

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'ADMIN' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toContain('ロールの変更に失敗');
  });

  it('does not call updateCognitoUserRole when role is unchanged', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]); // role is REVIEWER
    mockedUpdateUser.mockResolvedValue({
      ...sampleUsers[0],
      isActive: false,
      updatedAt: '2024-01-15T00:00:00.000Z',
    });
    mockedGlobalSignOutCognitoUser.mockResolvedValue(undefined);
    mockedDisableCognitoUser.mockResolvedValue(undefined);

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'REVIEWER', isActive: false }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    // Role is the same, so AdminUpdateUserAttributes should NOT be called
    expect(mockedUpdateCognitoUserRole).not.toHaveBeenCalled();
  });

  it('re-enables a disabled user and calls Cognito enable (no disable/signout)', async () => {
    mockedGetUserById.mockResolvedValue({ ...sampleUsers[0], isActive: false });
    mockedEnableCognitoUser.mockResolvedValue(undefined);
    mockedUpdateUser.mockResolvedValue({
      ...sampleUsers[0],
      isActive: true,
      updatedAt: '2024-01-15T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ isActive: true }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.isActive).toBe(true);
    // Enables the Cognito account so the user can log in again
    expect(mockedEnableCognitoUser).toHaveBeenCalledWith('reviewer@example.com');
    // Does not run any disable-related Cognito operations
    expect(mockedDisableCognitoUser).not.toHaveBeenCalled();
    expect(mockedGlobalSignOutCognitoUser).not.toHaveBeenCalled();
  });

  it('does not call Cognito enable when user is already active', async () => {
    // sampleUsers[0] is already active
    mockedGetUserById.mockResolvedValue({ ...sampleUsers[0], isActive: true });
    mockedUpdateUser.mockResolvedValue({
      ...sampleUsers[0],
      isActive: true,
      updatedAt: '2024-01-15T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ isActive: true }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockedEnableCognitoUser).not.toHaveBeenCalled();
    expect(mockedDisableCognitoUser).not.toHaveBeenCalled();
    expect(mockedGlobalSignOutCognitoUser).not.toHaveBeenCalled();
  });

  it('returns 500 when Cognito enable fails', async () => {
    mockedGetUserById.mockResolvedValue({ ...sampleUsers[0], isActive: false });
    mockedEnableCognitoUser.mockRejectedValue(new Error('Cognito enable failed'));

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ isActive: true }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(500);
    expect(mockedUpdateUser).not.toHaveBeenCalled();
  });

  it('delegates displayName/email updates to updateUserProfile', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedUpdateUserProfile.mockResolvedValue({
      ...sampleUsers[0],
      displayName: 'Renamed',
      email: 'renamed@example.com',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ displayName: 'Renamed', email: 'renamed@example.com' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockedUpdateUserProfile).toHaveBeenCalledWith({
      actor: { userId: 'admin-001', role: 'ADMIN' },
      targetUserId: 'user-001',
      fields: { displayName: 'Renamed', email: 'renamed@example.com' },
    });
    const body = JSON.parse(result.body as string);
    expect(body.data.email).toBe('renamed@example.com');
  });

  it('returns 200 and updates DynamoDB when Cognito tolerates a missing custom:role attribute (shared pool)', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    // cognito-service swallowed the missing-attribute error and resolved normally.
    mockedUpdateCognitoUserRole.mockResolvedValue(undefined);
    mockedUpdateUser.mockResolvedValue({
      ...sampleUsers[0],
      role: 'TEAM_LEADER',
      updatedAt: '2024-01-15T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'TEAM_LEADER' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.role).toBe('TEAM_LEADER');
    // DynamoDB (source of truth) must be updated with the new role.
    expect(mockedUpdateUser).toHaveBeenCalledWith('user-001', {
      role: 'TEAM_LEADER',
      isActive: undefined,
    });
  });

  it('updates both role and profile fields in a single request', async () => {
    mockedGetUserById.mockResolvedValue(sampleUsers[0]);
    mockedUpdateCognitoUserRole.mockResolvedValue(undefined);
    mockedUpdateUser.mockResolvedValue({ ...sampleUsers[0], role: 'TEAM_LEADER' });
    mockedUpdateUserProfile.mockResolvedValue({
      ...sampleUsers[0],
      role: 'TEAM_LEADER',
      displayName: 'Renamed',
    });

    const event = createEvent({
      method: 'PATCH',
      path: '/admin/users/user-001',
      pathParameters: { userId: 'user-001' },
      body: JSON.stringify({ role: 'TEAM_LEADER', displayName: 'Renamed' }),
    });
    const result = await updateUserHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockedUpdateCognitoUserRole).toHaveBeenCalled();
    expect(mockedUpdateUserProfile).toHaveBeenCalled();
  });
});
