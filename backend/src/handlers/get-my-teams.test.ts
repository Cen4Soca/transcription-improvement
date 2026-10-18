import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-my-teams.js';

vi.mock('../repositories/team-repository.js', () => ({
  getAllTeams: vi.fn(),
  getTeamsByUserId: vi.fn(),
}));

import { getAllTeams, getTeamsByUserId } from '../repositories/team-repository.js';

const mockedGetAllTeams = vi.mocked(getAllTeams);
const mockedGetTeamsByUserId = vi.mocked(getTeamsByUserId);

function createEvent(
  overrides: Partial<{ userId: string; role: string }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const { userId = 'user-001', role = 'TEAM_LEADER' } = overrides;

  return {
    version: '2.0',
    routeKey: 'GET /me/teams',
    rawPath: '/me/teams',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'test@example.com',
            'custom:role': role,
            'custom:displayName': 'Test User',
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: '/me/teams',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /me/teams',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleTeams = [
  {
    teamId: 'team-1',
    name: 'チームA',
    createdBy: 'admin-001',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    teamId: 'team-2',
    name: 'チームB',
    createdBy: 'admin-001',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
];

describe('GET /me/teams handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetAllTeams.mockResolvedValue(sampleTeams);
    mockedGetTeamsByUserId.mockResolvedValue([sampleTeams[0]]);
  });

  it('returns all teams for an ADMIN caller', async () => {
    const result = await handler(createEvent({ role: 'ADMIN', userId: 'admin-001' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(2);
    expect(mockedGetAllTeams).toHaveBeenCalledTimes(1);
    expect(mockedGetTeamsByUserId).not.toHaveBeenCalled();
  });

  it('returns only the caller teams for a TEAM_LEADER caller', async () => {
    const result = await handler(createEvent({ role: 'TEAM_LEADER', userId: 'leader-9' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].teamId).toBe('team-1');
    expect(mockedGetTeamsByUserId).toHaveBeenCalledWith('leader-9');
    expect(mockedGetAllTeams).not.toHaveBeenCalled();
  });

  it('returns only the caller teams for a REVIEWER caller', async () => {
    const result = await handler(createEvent({ role: 'REVIEWER', userId: 'rev-3' }));

    expect(result.statusCode).toBe(200);
    expect(mockedGetTeamsByUserId).toHaveBeenCalledWith('rev-3');
    expect(mockedGetAllTeams).not.toHaveBeenCalled();
  });

  it('returns 403 when the JWT sub claim is missing', async () => {
    const result = await handler(createEvent({ userId: '' }));

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 for unexpected errors', async () => {
    mockedGetTeamsByUserId.mockRejectedValue(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent({ role: 'REVIEWER' }));

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
