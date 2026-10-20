import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

vi.mock('../services/user-service.js', () => ({
  updateUserProfile: vi.fn(),
}));

vi.mock('../repositories/user-repository.js', () => ({
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
}));

import { handler } from './update-me.js';

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

import { updateUserProfile } from '../services/user-service.js';
import { getUserById, getUserByEmail } from '../repositories/user-repository.js';

const mockedUpdateUserProfile = vi.mocked(updateUserProfile);
const mockedGetUserById = vi.mocked(getUserById);
const mockedGetUserByEmail = vi.mocked(getUserByEmail);

const selfRecord = {
  userId: 'user-001',
  email: 'me@example.com',
  displayName: 'Me',
  role: 'REVIEWER' as const,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createEvent(body: string | undefined): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'PATCH /me',
    rawPath: '/me',
    rawQueryString: '',
    headers: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'user-001',
            email: 'me@example.com',
            'custom:role': 'REVIEWER',
            'custom:displayName': 'Me',
          },
          scopes: [],
        },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer['requestContext'],
    body,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetUserById.mockResolvedValue(selfRecord);
  mockedUpdateUserProfile.mockResolvedValue({ ...selfRecord, displayName: 'New Me' });
});

describe('PATCH /me - updateMe handler', () => {
  it('updates the caller own profile', async () => {
    const result = (await handler(
      createEvent(JSON.stringify({ displayName: 'New Me' }))
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    expect(mockedUpdateUserProfile).toHaveBeenCalledWith({
      actor: { userId: 'user-001', role: 'REVIEWER' },
      targetUserId: 'user-001',
      fields: { displayName: 'New Me', email: undefined },
    });
    const parsed = JSON.parse(result.body);
    expect(parsed.data.displayName).toBe('New Me');
  });

  it('rejects attempts to change role', async () => {
    const result = (await handler(
      createEvent(JSON.stringify({ role: 'ADMIN' }))
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects attempts to change isActive', async () => {
    const result = (await handler(
      createEvent(JSON.stringify({ isActive: false }))
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('falls back to email lookup when userId is not found by id', async () => {
    mockedGetUserById.mockResolvedValue(null);
    mockedGetUserByEmail.mockResolvedValue(selfRecord);

    const result = (await handler(
      createEvent(JSON.stringify({ displayName: 'New Me' }))
    )) as { statusCode: number };

    expect(mockedGetUserByEmail).toHaveBeenCalledWith('me@example.com');
    expect(result.statusCode).toBe(200);
  });

  it('returns forbidden when the user record cannot be resolved', async () => {
    mockedGetUserById.mockResolvedValue(null);
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = (await handler(
      createEvent(JSON.stringify({ displayName: 'New Me' }))
    )) as { statusCode: number };

    expect(result.statusCode).toBe(403);
  });

  it('returns validation error for invalid JSON body', async () => {
    const result = (await handler(createEvent('{invalid'))) as { statusCode: number };
    expect(result.statusCode).toBe(400);
  });
});
