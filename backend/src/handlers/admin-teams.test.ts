import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  listTeamsHandler,
  createTeamHandler,
  updateTeamHandler,
  deleteTeamHandler,
  addTeamMemberHandler,
  removeTeamMemberHandler,
} from './admin-teams.js';

vi.mock('../services/team-service.js', () => ({
  listTeams: vi.fn(),
  createNewTeam: vi.fn(),
  updateExistingTeam: vi.fn(),
  deleteExistingTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  addMemberToTeam: vi.fn(),
  removeMemberFromTeam: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import {
  listTeams,
  createNewTeam,
  updateExistingTeam,
  deleteExistingTeam,
  listTeamMembers,
  addMemberToTeam,
  removeMemberFromTeam,
} from '../services/team-service.js';
import { AppError } from '../utils/error-handler.js';

const mockedListTeams = vi.mocked(listTeams);
const mockedCreateNewTeam = vi.mocked(createNewTeam);
const mockedUpdateExistingTeam = vi.mocked(updateExistingTeam);
const mockedDeleteExistingTeam = vi.mocked(deleteExistingTeam);
const mockedListTeamMembers = vi.mocked(listTeamMembers);
const mockedAddMemberToTeam = vi.mocked(addMemberToTeam);
const mockedRemoveMemberFromTeam = vi.mocked(removeMemberFromTeam);

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
    path = '/admin/teams',
    userId = 'admin-001',
    role = 'ADMIN',
    pathParameters,
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

const sampleTeam = {
  teamId: 'team-001',
  name: 'Translation Team',
  createdBy: 'admin-001',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('GET /admin/teams - listTeamsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns teams from service', async () => {
    mockedListTeams.mockResolvedValue([sampleTeam]);

    const event = createEvent({ role: 'ADMIN' });
    const result = await listTeamsHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].teamId).toBe('team-001');
  });

  it('returns 403 when service throws forbidden error', async () => {
    mockedListTeams.mockRejectedValue(
      new AppError({
        code: 'FORBIDDEN',
        message: 'この操作を実行する権限がありません。',
        statusCode: 403,
      })
    );

    const event = createEvent({ role: 'REVIEWER' });
    const result = await listTeamsHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /admin/teams - createTeamHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a team via service', async () => {
    mockedCreateNewTeam.mockResolvedValue(sampleTeam);

    const event = createEvent({
      method: 'POST',
      role: 'ADMIN',
      body: JSON.stringify({ name: 'Translation Team' }),
    });
    const result = await createTeamHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.teamId).toBe('team-001');
    expect(mockedCreateNewTeam).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-001', role: 'ADMIN' }),
      { name: 'Translation Team', members: undefined }
    );
  });

  it('returns 400 when service throws validation error', async () => {
    mockedCreateNewTeam.mockRejectedValue(
      new AppError({
        code: 'VALIDATION_ERROR',
        message: 'チーム名は必須です。',
        statusCode: 400,
      })
    );

    const event = createEvent({
      method: 'POST',
      role: 'ADMIN',
      body: JSON.stringify({}),
    });
    const result = await createTeamHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('チーム名は必須です。');
  });

  it('returns 403 for REVIEWER', async () => {
    mockedCreateNewTeam.mockRejectedValue(
      new AppError({
        code: 'FORBIDDEN',
        message: 'この操作を実行する権限がありません。',
        statusCode: 403,
      })
    );

    const event = createEvent({
      method: 'POST',
      role: 'REVIEWER',
      body: JSON.stringify({ name: 'Team' }),
    });
    const result = await createTeamHandler(event);

    expect(result.statusCode).toBe(403);
  });
});

describe('PATCH /admin/teams/{teamId} - updateTeamHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates a team via service', async () => {
    mockedUpdateExistingTeam.mockResolvedValue({
      ...sampleTeam,
      name: 'Updated Team',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'PATCH',
      role: 'ADMIN',
      pathParameters: { teamId: 'team-001' },
      body: JSON.stringify({ name: 'Updated Team' }),
    });
    const result = await updateTeamHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.name).toBe('Updated Team');
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({
      method: 'PATCH',
      role: 'ADMIN',
      pathParameters: {},
      body: JSON.stringify({ name: 'Updated Team' }),
    });
    const result = await updateTeamHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('rejects TEAM_LEADER updating another team (Req 13.9)', async () => {
    mockedUpdateExistingTeam.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'リソースが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      method: 'PATCH',
      role: 'TEAM_LEADER',
      userId: 'leader-002',
      pathParameters: { teamId: 'team-001' },
      body: JSON.stringify({ name: 'Hacked Team' }),
    });
    const result = await updateTeamHandler(event);

    expect(result.statusCode).toBe(404);
  });

  it('returns 404 when team does not exist', async () => {
    mockedUpdateExistingTeam.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'チームが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      method: 'PATCH',
      role: 'ADMIN',
      pathParameters: { teamId: 'nonexistent' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    const result = await updateTeamHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toBe('チームが見つかりません。');
  });
});

describe('DELETE /admin/teams/{teamId} - deleteTeamHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a team via service for ADMIN (Req 13.10)', async () => {
    mockedDeleteExistingTeam.mockResolvedValue(undefined);

    const event = createEvent({
      method: 'DELETE',
      role: 'ADMIN',
      pathParameters: { teamId: 'team-001' },
    });
    const result = await deleteTeamHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deleted).toBe(true);
    expect(mockedDeleteExistingTeam).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-001', role: 'ADMIN' }),
      'team-001'
    );
  });

  it('returns 403 for TEAM_LEADER (only ADMIN can delete)', async () => {
    mockedDeleteExistingTeam.mockRejectedValue(
      new AppError({
        code: 'FORBIDDEN',
        message: 'チームの削除はAdmin権限が必要です。',
        statusCode: 403,
      })
    );

    const event = createEvent({
      method: 'DELETE',
      role: 'TEAM_LEADER',
      pathParameters: { teamId: 'team-001' },
    });
    const result = await deleteTeamHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.message).toBe('チームの削除はAdmin権限が必要です。');
  });

  it('returns 404 when team does not exist', async () => {
    mockedDeleteExistingTeam.mockRejectedValue(
      new AppError({
        code: 'NOT_FOUND',
        message: 'チームが見つかりません。',
        statusCode: 404,
      })
    );

    const event = createEvent({
      method: 'DELETE',
      role: 'ADMIN',
      pathParameters: { teamId: 'nonexistent' },
    });
    const result = await deleteTeamHandler(event);

    expect(result.statusCode).toBe(404);
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({
      method: 'DELETE',
      role: 'ADMIN',
      pathParameters: {},
    });
    const result = await deleteTeamHandler(event);

    expect(result.statusCode).toBe(400);
  });
});

describe('POST /admin/teams/{teamId}/members - addTeamMemberHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a member to a team via service', async () => {
    mockedAddMemberToTeam.mockResolvedValue({
      teamId: 'team-001',
      userId: 'user-002',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const event = createEvent({
      method: 'POST',
      role: 'ADMIN',
      pathParameters: { teamId: 'team-001' },
      body: JSON.stringify({ userId: 'user-002' }),
    });
    const result = await addTeamMemberHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.data.userId).toBe('user-002');
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({
      method: 'POST',
      role: 'ADMIN',
      pathParameters: {},
      body: JSON.stringify({ userId: 'user-002' }),
    });
    const result = await addTeamMemberHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('rejects TEAM_LEADER adding member to another team (Req 13.9)', async () => {
    mockedAddMemberToTeam.mockRejectedValue(
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
      pathParameters: { teamId: 'team-001' },
      body: JSON.stringify({ userId: 'user-003' }),
    });
    const result = await addTeamMemberHandler(event);

    expect(result.statusCode).toBe(404);
  });
});

describe('DELETE /admin/teams/{teamId}/members/{userId} - removeTeamMemberHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes a member from a team via service', async () => {
    mockedRemoveMemberFromTeam.mockResolvedValue(undefined);

    const event = createEvent({
      method: 'DELETE',
      role: 'ADMIN',
      pathParameters: { teamId: 'team-001', userId: 'user-002' },
    });
    const result = await removeTeamMemberHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.deleted).toBe(true);
    expect(mockedRemoveMemberFromTeam).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-001', role: 'ADMIN' }),
      'team-001',
      'user-002'
    );
  });

  it('returns 400 when teamId is missing', async () => {
    const event = createEvent({
      method: 'DELETE',
      role: 'ADMIN',
      pathParameters: { userId: 'user-002' },
    });
    const result = await removeTeamMemberHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when userId is missing', async () => {
    const event = createEvent({
      method: 'DELETE',
      role: 'ADMIN',
      pathParameters: { teamId: 'team-001' },
    });
    const result = await removeTeamMemberHandler(event);

    expect(result.statusCode).toBe(400);
  });
});
