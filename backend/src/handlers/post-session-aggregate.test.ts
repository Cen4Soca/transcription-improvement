import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './post-session-aggregate.js';


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

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn().mockImplementation((params) => ({ __type: 'Put', ...params })),
  QueryCommand: vi.fn().mockImplementation((params) => ({ __type: 'Query', ...params })),
  UpdateCommand: vi.fn().mockImplementation((params) => ({ __type: 'Update', ...params })),
}));

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
  updateSessionStatus: vi.fn(),
  countParticipants: vi.fn(),
}));

vi.mock('../services/access-control-service.js', () => ({
  isTeamMember: vi.fn(),
}));

vi.mock('../services/audit-service.js', () => ({
  recordAuditLog: vi.fn(),
}));

import {
  getSessionById,
  updateSessionStatus,
  countParticipants,
} from '../repositories/session-repository.js';
import { isTeamMember } from '../services/access-control-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const mockedGetSessionById = vi.mocked(getSessionById);
const mockedUpdateSessionStatus = vi.mocked(updateSessionStatus);
const mockedCountParticipants = vi.mocked(countParticipants);
const mockedIsTeamMember = vi.mocked(isTeamMember);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

function createEvent(
  overrides: Partial<{ userId: string; role: string; sessionId: string | null }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const userId = overrides.userId ?? 'admin-001';
  const role = overrides.role ?? 'ADMIN';
  const sessionId = overrides.sessionId === undefined ? 'session-001' : overrides.sessionId;
  return {
    version: '2.0',
    routeKey: 'POST /sessions/{sessionId}/aggregate',
    rawPath: `/sessions/${sessionId}/aggregate`,
    rawQueryString: '',
    headers: {},
    pathParameters: sessionId ? { sessionId } : undefined,
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: 'a@example.com',
            'custom:role': role,
            'custom:displayName': 'A',
          },
          scopes: [],
        },
      },
      http: { method: 'POST', path: `/sessions/${sessionId}/aggregate`, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey: 'POST /sessions/{sessionId}/aggregate',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const session = {
  sessionId: 'session-001',
  name: 'Session',
  status: 'IN_PROGRESS' as const,
  assignedTeamId: 'team-001',
  assignedReviewerCount: 2,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

/**
 * Configure the docClient mock to answer, in order:
 * 1. getSegments (Query on SEGMENT#)  → given segment items
 * 2..N. per-segment getSegmentCorrections (Query on GSI1) → given corrections
 * then any Put/Update just resolve.
 */
function primeDocClient(
  segments: Array<{ segmentId: string; consensusStatus?: string }>,
  correctionsBySegment: Record<string, Array<{ userId: string; afterText: string }>>
) {
  mockSend.mockImplementation((cmd: Record<string, unknown>) => {
    const type = cmd['__type'];
    const values = (cmd['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>;

    if (type === 'Query') {
      const prefix = values[':prefix'] as string | undefined;
      // getSegments: SK begins_with SEGMENT#
      if (prefix === 'SEGMENT#') {
        return Promise.resolve({
          Items: segments.map((s, i) => ({
            PK: 'SESSION#session-001',
            SK: `SEGMENT#${i}`,
            segmentId: s.segmentId,
            consensusStatus: s.consensusStatus ?? 'UNDECIDED',
          })),
        });
      }
      // getSegmentCorrections: GSI1PK = SEGMENT#{segmentId}
      const gsi1pk = values[':gsi1pk'] as string | undefined;
      if (gsi1pk && gsi1pk.startsWith('SEGMENT#')) {
        const segmentId = gsi1pk.replace('SEGMENT#', '');
        const corrs = correctionsBySegment[segmentId] ?? [];
        return Promise.resolve({
          Items: corrs.map((c) => ({ userId: c.userId, afterText: c.afterText })),
        });
      }
    }

    // Put (ConsensusResult) / Update (segment status) → succeed
    return Promise.resolve({});
  });
}

describe('POST /sessions/{sessionId}/aggregate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUpdateSessionStatus.mockResolvedValue({ ...session, status: 'COMPLETED' });
  });

  it('aggregates all segments and completes the session (ADMIN)', async () => {
    mockedGetSessionById.mockResolvedValue(session);
    mockedCountParticipants.mockResolvedValue(2);
    primeDocClient(
      [{ segmentId: 'seg-1' }, { segmentId: 'seg-2' }],
      {
        // seg-1: both agree → CONFIRMED
        'seg-1': [
          { userId: 'u1', afterText: 'A' },
          { userId: 'u2', afterText: 'A' },
        ],
        // seg-2: split → CONFLICT
        'seg-2': [
          { userId: 'u1', afterText: 'B' },
          { userId: 'u2', afterText: 'C' },
        ],
      }
    );

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.status).toBe('COMPLETED');
    expect(body.data.totalReviewers).toBe(2);
    expect(body.data.confirmedCount).toBe(1);
    expect(body.data.conflictCount).toBe(1);
    expect(mockedUpdateSessionStatus).toHaveBeenCalledWith('session-001', 'COMPLETED');
    expect(mockedRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: 'SESSION_MANUAL_AGGREGATED' })
    );
  });

  it('confirms even with a single reviewer below the 3-reviewer minimum', async () => {
    mockedGetSessionById.mockResolvedValue(session);
    mockedCountParticipants.mockResolvedValue(1);
    primeDocClient([{ segmentId: 'seg-1' }], {
      'seg-1': [{ userId: 'u1', afterText: 'only answer' }],
    });

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.data.confirmedCount).toBe(1);
    expect(body.data.conflictCount).toBe(0);
  });

  it('lets a TEAM_LEADER aggregate a session in their own team', async () => {
    mockedGetSessionById.mockResolvedValue(session);
    mockedIsTeamMember.mockResolvedValue(true);
    mockedCountParticipants.mockResolvedValue(2);
    primeDocClient([{ segmentId: 'seg-1' }], {
      'seg-1': [
        { userId: 'u1', afterText: 'A' },
        { userId: 'u2', afterText: 'A' },
      ],
    });

    const result = await handler(
      createEvent({ userId: 'leader-001', role: 'TEAM_LEADER' })
    );

    expect(result.statusCode).toBe(200);
    expect(mockedIsTeamMember).toHaveBeenCalledWith('leader-001', 'team-001');
  });

  it('forbids a TEAM_LEADER from aggregating another team session (403)', async () => {
    mockedGetSessionById.mockResolvedValue(session);
    mockedIsTeamMember.mockResolvedValue(false);

    const result = await handler(
      createEvent({ userId: 'leader-001', role: 'TEAM_LEADER' })
    );

    expect(result.statusCode).toBe(403);
    expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
  });

  it('forbids a REVIEWER (403)', async () => {
    const result = await handler(
      createEvent({ userId: 'reviewer-001', role: 'REVIEWER' })
    );
    expect(result.statusCode).toBe(403);
    expect(mockedGetSessionById).not.toHaveBeenCalled();
  });

  it('returns 400 when sessionId is missing', async () => {
    const result = await handler(createEvent({ sessionId: null }));
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when the session does not exist', async () => {
    mockedGetSessionById.mockResolvedValue(null);
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(404);
  });

  it('returns 400 when the session is already COMPLETED', async () => {
    mockedGetSessionById.mockResolvedValue({ ...session, status: 'COMPLETED' });
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(400);
    expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
  });
});
