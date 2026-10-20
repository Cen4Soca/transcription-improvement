import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  listTeamAssignmentsHandler,
  createTeamAssignmentHandler,
  deleteTeamAssignmentHandler,
  createReviewAssignmentHandler,
} from './team-assignments.js';


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

vi.mock('../services/team-service.js', () => ({
  listAssignments: vi.fn(),
  createAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  createUserReviewAssignment: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import {
  listAssignments,
  createAssignment,
  deleteAssignment,
  createUserReviewAssignment,
} from '../services/team-service.js';
import { AppError } from '../utils/error-handler.js';

const mockedListAssignments = vi.mocked(listAssignments);
const mockedCreateAssignment = vi.mocked(createAssignment);
const mockedDeleteAssignment = vi.mocked(deleteAssignment);
const mockedCreateUserReviewAssignment = vi.mocked(createUserReviewAssignment);

function createEvent(overrides: {
  method?: string;
  path?: string;
  userId?: string;
  role?: string;
  pathParameters?: Record<string, string>;
  body?: string;
}): APIGatewayProxyEventV2WithJWTAuthorizer {
  const {
    method = 'GET',
    path = '/admin/teams/team-001/assignments',
    userId = 'admin-001',
    role = 'ADMIN',
    pathParameters = { teamId: 'team-001' },
    body,
  } = overrides;

  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    body,
    pathParameters,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'admin@example.com',
            'custom:role': role,
            'custom:displayName': 'Admin User',
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

const sampleAssignment = {
  teamId: 'team-001',
  sessionId: 'session-001',
  createdBy: 'admin-001',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('GET /admin/teams/{teamId}/assignments - listTeamAssignmentsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all assignments for a team', async () => {
    mockedListAssignments.mockResolvedValue([sampleAssignment]);

    const event = createEvent({});
    const result = await listTeamAssignmentsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].sessionId).toBe('session-001');
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({ pathParameters: {} });
    const result = await listTeamAssignmentsHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('rejects TEAM_LEADER accessing another team (Req 13.9)', async () => {
    mockedListAssignments.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      role: 'TEAM_LEADER',
      userId: 'leader-002',
    });
    const result = await listTeamAssignmentsHandler(event);

    expect(result.statusCode).toBe(404);
  });
});

describe('POST /admin/teams/{teamId}/assignments - createTeamAssignmentHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a TeamAssignment (Req 13.4)', async () => {
    mockedCreateAssignment.mockResolvedValue(sampleAssignment);

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ sessionId: 'session-001' }),
    });
    const result = await createTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.teamId).toBe('team-001');
    expect(body.data.sessionId).toBe('session-001');
    expect(mockedCreateAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-001', role: 'ADMIN' }),
      'team-001',
      'session-001'
    );
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({
      method: 'POST',
      pathParameters: {},
      body: JSON.stringify({ sessionId: 'session-001' }),
    });
    const result = await createTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('returns validation error when sessionId is missing', async () => {
    mockedCreateAssignment.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'セッションIDは必須です。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({}),
    });
    const result = await createTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toBe('セッションIDは必須です。');
  });

  it('TEAM_LEADER can create assignment for their own team', async () => {
    mockedCreateAssignment.mockResolvedValue({
      ...sampleAssignment,
      createdBy: 'leader-001',
    });

    const event = createEvent({
      method: 'POST',
      role: 'TEAM_LEADER',
      userId: 'leader-001',
      body: JSON.stringify({ sessionId: 'session-002' }),
    });
    const result = await createTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(201);
  });

  it('rejects TEAM_LEADER creating assignment for another team (Req 13.9)', async () => {
    mockedCreateAssignment.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      method: 'POST',
      role: 'TEAM_LEADER',
      userId: 'leader-002',
      body: JSON.stringify({ sessionId: 'session-001' }),
    });
    const result = await createTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(404);
  });

  it('rejects REVIEWER from creating TeamAssignment', async () => {
    mockedCreateAssignment.mockRejectedValue(
      new AppError({
        code: 'FORBIDDEN',
        message: 'この操作を実行する権限がありません。',
        statusCode: 403,
      })
    );

    const event = createEvent({
      method: 'POST',
      role: 'REVIEWER',
      userId: 'reviewer-001',
      body: JSON.stringify({ sessionId: 'session-001' }),
    });
    const result = await createTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(403);
  });
});

describe('DELETE /admin/teams/{teamId}/assignments/{sessionId} - deleteTeamAssignmentHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a TeamAssignment (Req 13.5)', async () => {
    mockedDeleteAssignment.mockResolvedValue(undefined);

    const event = createEvent({
      method: 'DELETE',
      pathParameters: { teamId: 'team-001', sessionId: 'session-001' },
    });
    const result = await deleteTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deleted).toBe(true);
    expect(mockedDeleteAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-001', role: 'ADMIN' }),
      'team-001',
      'session-001'
    );
  });

  it('returns 400 when sessionId is missing', async () => {
    const event = createEvent({
      method: 'DELETE',
      pathParameters: { teamId: 'team-001' },
    });
    const result = await deleteTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toBe('セッションIDは必須です。');
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({
      method: 'DELETE',
      pathParameters: { sessionId: 'session-001' },
    });
    const result = await deleteTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('rejects TEAM_LEADER deleting assignment from another team (Req 13.9)', async () => {
    mockedDeleteAssignment.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      method: 'DELETE',
      role: 'TEAM_LEADER',
      userId: 'leader-002',
      pathParameters: { teamId: 'team-001', sessionId: 'session-001' },
    });
    const result = await deleteTeamAssignmentHandler(event);

    expect(result.statusCode).toBe(404);
  });
});

describe('POST /admin/teams/{teamId}/review-assignments - createReviewAssignmentHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a ReviewAssignment for a team member (Req 13.8)', async () => {
    mockedCreateUserReviewAssignment.mockResolvedValue({
      userId: 'user-001',
      sessionId: 'session-001',
      createdBy: 'admin-001',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'POST',
      path: '/admin/teams/team-001/review-assignments',
      body: JSON.stringify({ userId: 'user-001', sessionId: 'session-001' }),
    });
    const result = await createReviewAssignmentHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.userId).toBe('user-001');
    expect(body.data.sessionId).toBe('session-001');
  });

  it('rejects when target user is not a team member', async () => {
    mockedCreateUserReviewAssignment.mockRejectedValue(
      new AppError({
        code: 'FORBIDDEN',
        message: '対象ユーザーはこのチームのメンバーではありません。',
        statusCode: 403,
      })
    );

    const event = createEvent({
      method: 'POST',
      path: '/admin/teams/team-001/review-assignments',
      body: JSON.stringify({ userId: 'user-999', sessionId: 'session-001' }),
    });
    const result = await createReviewAssignmentHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toBe(
      '対象ユーザーはこのチームのメンバーではありません。'
    );
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({
      method: 'POST',
      pathParameters: {},
      body: JSON.stringify({ userId: 'user-001', sessionId: 'session-001' }),
    });
    const result = await createReviewAssignmentHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('returns validation error when userId is missing', async () => {
    mockedCreateUserReviewAssignment.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'ユーザーIDは必須です。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ sessionId: 'session-001' }),
    });
    const result = await createReviewAssignmentHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toBe('ユーザーIDは必須です。');
  });

  it('returns validation error when sessionId is missing', async () => {
    mockedCreateUserReviewAssignment.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'セッションIDは必須です。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      method: 'POST',
      body: JSON.stringify({ userId: 'user-001' }),
    });
    const result = await createReviewAssignmentHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toBe('セッションIDは必須です。');
  });

  it('rejects TEAM_LEADER creating ReviewAssignment for another team (Req 13.9)', async () => {
    mockedCreateUserReviewAssignment.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      method: 'POST',
      role: 'TEAM_LEADER',
      userId: 'leader-002',
      body: JSON.stringify({ userId: 'user-001', sessionId: 'session-001' }),
    });
    const result = await createReviewAssignmentHandler(event);

    expect(result.statusCode).toBe(404);
  });
});
