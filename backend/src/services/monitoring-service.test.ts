import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthUser } from '../utils/auth-middleware.js';
import type { SessionRecord } from '../repositories/session-repository.js';

vi.mock('../repositories/session-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repositories/session-repository.js')>();
  return {
    ...actual,
    getAllSessions: vi.fn(),
    getSessionsByTeamId: vi.fn(),
    getSessionById: vi.fn(),
    getParticipants: vi.fn(),
    getSessionsByParticipantUserId: vi.fn(),
    getSessionIdsByParticipantUserId: vi.fn(),
  };
});
vi.mock('../repositories/correction-repository.js', () => ({
  getLastCorrectionAt: vi.fn(),
  getCorrections: vi.fn(),
}));
vi.mock('../repositories/segment-repository.js', () => ({
  getSessionSegments: vi.fn(),
}));
vi.mock('../repositories/team-repository.js', () => ({
  getTeamsByUserId: vi.fn(),
  getTeamMembers: vi.fn(),
  getTeamById: vi.fn(),
}));
vi.mock('../repositories/user-repository.js', () => ({
  getAllUsers: vi.fn(),
  getUserById: vi.fn(),
}));

import * as sessionRepo from '../repositories/session-repository.js';
import * as correctionRepo from '../repositories/correction-repository.js';
import * as segmentRepo from '../repositories/segment-repository.js';
import * as teamRepo from '../repositories/team-repository.js';
import * as userRepo from '../repositories/user-repository.js';
import {
  listSessionMonitoring,
  getSessionProgress,
  listUserWorkload,
  listUserSessions,
  resolveScope,
} from './monitoring-service.js';

const NOW = new Date('2026-11-26T00:00:00.000Z');
const OLD = '2026-11-01T00:00:00.000Z'; // 25 days before NOW
const RECENT = '2026-11-25T00:00:00.000Z'; // 1 day before NOW

const admin: AuthUser = { userId: 'admin', email: 'a@x', displayName: 'Admin', role: 'ADMIN' };
const leader: AuthUser = { userId: 'lead', email: 'l@x', displayName: 'Lead', role: 'TEAM_LEADER' };
const reviewer: AuthUser = { userId: 'rev', email: 'r@x', displayName: 'Rev', role: 'REVIEWER' };

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 's1',
    name: 'Session 1',
    status: 'IN_PROGRESS',
    assignedReviewerCount: 1,
    consensusThreshold: 67,
    createdAt: OLD,
    updatedAt: OLD,
    assignedTeamId: 't1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(teamRepo.getTeamsByUserId).mockResolvedValue([
    { teamId: 't1', name: 'Team 1', createdBy: 'x', createdAt: OLD, updatedAt: OLD },
  ]);
  vi.mocked(teamRepo.getTeamById).mockResolvedValue({
    teamId: 't1', name: 'Team 1', createdBy: 'x', createdAt: OLD, updatedAt: OLD,
  });
  vi.mocked(userRepo.getUserById).mockImplementation(async (id: string) => ({
    userId: id, email: `${id}@x`, displayName: `User ${id}`, role: 'REVIEWER',
    isActive: true, createdAt: OLD, updatedAt: OLD,
  }));
  vi.mocked(sessionRepo.getParticipants).mockResolvedValue([
    { sessionId: 's1', userId: 'u1', joinedAt: OLD },
  ]);
});

describe('resolveScope', () => {
  it('rejects REVIEWER with 403', async () => {
    await expect(resolveScope(reviewer)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('derives TEAM_LEADER teams from the database', async () => {
    const scope = await resolveScope(leader);
    expect(scope.all).toBe(false);
    expect([...scope.teamIds]).toEqual(['t1']);
    expect(teamRepo.getTeamsByUserId).toHaveBeenCalledWith('lead');
  });
});

describe('listSessionMonitoring', () => {
  it('TEAM_LEADER reads only own-team sessions and never lists all sessions', async () => {
    vi.mocked(sessionRepo.getSessionsByTeamId).mockResolvedValue([session()]);
    vi.mocked(correctionRepo.getLastCorrectionAt).mockResolvedValue(RECENT);

    const result = await listSessionMonitoring(leader, {}, 1, NOW);

    expect(sessionRepo.getSessionsByTeamId).toHaveBeenCalledTimes(1);
    expect(sessionRepo.getSessionsByTeamId).toHaveBeenCalledWith('t1');
    expect(sessionRepo.getAllSessions).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sessionId: 's1',
      assignedTeamName: 'Team 1',
      isStalled: false,
      lastActivityAt: RECENT,
    });
  });

  it('flags an IN_PROGRESS session with old corrections as stalled', async () => {
    vi.mocked(sessionRepo.getAllSessions).mockResolvedValue([session()]);
    vi.mocked(correctionRepo.getLastCorrectionAt).mockResolvedValue(OLD);

    const result = await listSessionMonitoring(admin, {}, 1, NOW);
    expect(result.items[0]?.isStalled).toBe(true);
  });

  it('falls back to createdAt when nobody has corrected anything', async () => {
    vi.mocked(sessionRepo.getAllSessions).mockResolvedValue([session({ createdAt: OLD })]);
    vi.mocked(correctionRepo.getLastCorrectionAt).mockResolvedValue(null);

    const result = await listSessionMonitoring(admin, {}, 1, NOW);
    expect(result.items[0]).toMatchObject({ lastActivityAt: OLD, isStalled: true });
  });

  it('uses the newest correction among all participants', async () => {
    vi.mocked(sessionRepo.getAllSessions).mockResolvedValue([session()]);
    vi.mocked(sessionRepo.getParticipants).mockResolvedValue([
      { sessionId: 's1', userId: 'u1', joinedAt: OLD },
      { sessionId: 's1', userId: 'u2', joinedAt: OLD },
    ]);
    vi.mocked(correctionRepo.getLastCorrectionAt).mockImplementation(async (_s, u) =>
      u === 'u1' ? OLD : RECENT
    );

    const result = await listSessionMonitoring(admin, {}, 1, NOW);
    expect(result.items[0]).toMatchObject({ lastActivityAt: RECENT, isStalled: false });
  });

  it('never marks non IN_PROGRESS sessions as stalled and skips activity lookups', async () => {
    vi.mocked(sessionRepo.getAllSessions).mockResolvedValue([
      session({ sessionId: 'p', status: 'PENDING' }),
      session({ sessionId: 'c', status: 'COMPLETED' }),
    ]);

    const result = await listSessionMonitoring(admin, {}, 1, NOW);
    expect(result.items.every((i) => !i.isStalled && i.lastActivityAt === null)).toBe(true);
    expect(correctionRepo.getLastCorrectionAt).not.toHaveBeenCalled();
  });

  it('stalledOnly keeps only stalled sessions', async () => {
    vi.mocked(sessionRepo.getAllSessions).mockResolvedValue([
      session({ sessionId: 'old' }),
      session({ sessionId: 'fresh' }),
      session({ sessionId: 'done', status: 'COMPLETED' }),
    ]);
    vi.mocked(sessionRepo.getParticipants).mockImplementation(async (id: string) => [
      { sessionId: id, userId: 'u1', joinedAt: OLD },
    ]);
    vi.mocked(correctionRepo.getLastCorrectionAt).mockImplementation(async (id: string) =>
      id === 'fresh' ? RECENT : OLD
    );

    const result = await listSessionMonitoring(admin, { stalledOnly: true }, 1, NOW);
    expect(result.items.map((i) => i.sessionId)).toEqual(['old']);
    expect(result.pagination.totalItems).toBe(1);
  });

  it('unassignedOnly keeps sessions with no assignee and no participants', async () => {
    vi.mocked(sessionRepo.getAllSessions).mockResolvedValue([
      session({ sessionId: 'free', status: 'PENDING', assignedReviewerCount: 0 }),
      session({ sessionId: 'taken', status: 'PENDING', assignedUserId: 'u1', assignedReviewerCount: 1 }),
    ]);

    const result = await listSessionMonitoring(admin, { unassignedOnly: true }, 1, NOW);
    expect(result.items.map((i) => i.sessionId)).toEqual(['free']);
    expect(result.items[0]?.isUnassigned).toBe(true);
  });

  it('userId filter matches assignee or participant', async () => {
    vi.mocked(sessionRepo.getAllSessions).mockResolvedValue([
      session({ sessionId: 'a', status: 'PENDING', assignedUserId: 'u9' }),
      session({ sessionId: 'b', status: 'PENDING' }),
      session({ sessionId: 'c', status: 'PENDING' }),
    ]);
    vi.mocked(sessionRepo.getSessionIdsByParticipantUserId).mockResolvedValue(['b']);

    const result = await listSessionMonitoring(admin, { userId: 'u9' }, 1, NOW);
    expect(result.items.map((i) => i.sessionId).sort()).toEqual(['a', 'b']);
  });
});

describe('getSessionProgress', () => {
  it('returns 404 for a TEAM_LEADER outside the session team', async () => {
    vi.mocked(sessionRepo.getSessionById).mockResolvedValue(session({ assignedTeamId: 'other' }));
    await expect(getSessionProgress(leader, 's1', NOW)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for a missing session', async () => {
    vi.mocked(sessionRepo.getSessionById).mockResolvedValue(null);
    await expect(getSessionProgress(admin, 'nope', NOW)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for a REVIEWER', async () => {
    await expect(getSessionProgress(reviewer, 's1', NOW)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('counts each segment once and ignores non-TEXT and unknown segments', async () => {
    vi.mocked(sessionRepo.getSessionById).mockResolvedValue(session());
    vi.mocked(segmentRepo.getSessionSegments).mockResolvedValue(
      ['g1', 'g2', 'g3', 'g4'].map((segmentId, i) => ({ segmentId, startTime: i, originalText: 't' }))
    );
    const c = (segmentId: string, correctionType: 'TEXT' | 'SPEAKER', createdAt: string) => ({
      correctionId: `${segmentId}-${createdAt}`, sessionId: 's1', segmentId, userId: 'u1',
      correctionType, beforeText: '', afterText: '', createdAt,
    });
    vi.mocked(correctionRepo.getCorrections).mockResolvedValue([
      c('g1', 'TEXT', OLD),
      c('g1', 'TEXT', RECENT), // duplicate segment
      c('g2', 'SPEAKER', RECENT), // not a text correction
      c('ghost', 'TEXT', RECENT), // not a segment of this session
    ]);

    const result = await getSessionProgress(admin, 's1', NOW);
    expect(result.totalSegments).toBe(4);
    expect(result.reviewers).toHaveLength(1);
    expect(result.reviewers[0]).toMatchObject({
      userId: 'u1',
      displayName: 'User u1',
      correctedSegments: 1,
      progressPercent: 25,
      lastActivityAt: RECENT,
    });
    expect(result.isStalled).toBe(false);
  });

  it('reports 0% when the session has no segments', async () => {
    vi.mocked(sessionRepo.getSessionById).mockResolvedValue(session());
    vi.mocked(segmentRepo.getSessionSegments).mockResolvedValue([]);
    vi.mocked(correctionRepo.getCorrections).mockResolvedValue([]);

    const result = await getSessionProgress(admin, 's1', NOW);
    expect(result.reviewers[0]?.progressPercent).toBe(0);
    expect(result.isStalled).toBe(true); // createdAt is 25 days old
  });
});

describe('listUserWorkload', () => {
  it('counts assigned, in-progress and stalled sessions per member', async () => {
    vi.mocked(teamRepo.getTeamMembers).mockResolvedValue([
      { teamId: 't1', userId: 'u1', createdAt: OLD },
    ]);
    vi.mocked(sessionRepo.getSessionsByParticipantUserId).mockResolvedValue([
      session({ sessionId: 's-old' }),
      session({ sessionId: 's-fresh' }),
      session({ sessionId: 's-done', status: 'COMPLETED' }),
      session({ sessionId: 's-other-team', assignedTeamId: 'other' }),
    ]);
    vi.mocked(sessionRepo.getParticipants).mockImplementation(async (id: string) => [
      { sessionId: id, userId: 'u1', joinedAt: OLD },
    ]);
    vi.mocked(correctionRepo.getLastCorrectionAt).mockImplementation(async (id: string) =>
      id === 's-fresh' ? RECENT : OLD
    );

    const result = await listUserWorkload(leader, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: 'u1',
      assignedCount: 3, // the other-team session is outside the leader's scope
      inProgressCount: 2,
      stalledCount: 1,
    });
  });

  it('ADMIN lists every user', async () => {
    vi.mocked(userRepo.getAllUsers).mockResolvedValue([
      { userId: 'u1', email: 'u1@x', displayName: 'B', role: 'REVIEWER', isActive: true, createdAt: OLD, updatedAt: OLD },
      { userId: 'u2', email: 'u2@x', displayName: 'A', role: 'TEAM_LEADER', isActive: true, createdAt: OLD, updatedAt: OLD },
    ]);
    vi.mocked(sessionRepo.getSessionsByParticipantUserId).mockResolvedValue([]);

    const result = await listUserWorkload(admin, NOW);
    expect(result.map((r) => r.displayName)).toEqual(['A', 'B']);
    expect(teamRepo.getTeamsByUserId).not.toHaveBeenCalled();
  });
});

describe('listUserSessions', () => {
  it('returns 404 when the target is not a member of the leader teams', async () => {
    vi.mocked(teamRepo.getTeamMembers).mockResolvedValue([
      { teamId: 't1', userId: 'u1', createdAt: OLD },
    ]);
    await expect(listUserSessions(leader, 'stranger', NOW)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns the member sessions with per-user progress', async () => {
    vi.mocked(teamRepo.getTeamMembers).mockResolvedValue([
      { teamId: 't1', userId: 'u1', createdAt: OLD },
    ]);
    vi.mocked(sessionRepo.getSessionsByParticipantUserId).mockResolvedValue([
      session({ sessionId: 's1' }),
      session({ sessionId: 'hidden', assignedTeamId: 'other' }),
    ]);
    vi.mocked(segmentRepo.getSessionSegments).mockResolvedValue(
      ['g1', 'g2'].map((segmentId, i) => ({ segmentId, startTime: i, originalText: 't' }))
    );
    vi.mocked(correctionRepo.getCorrections).mockResolvedValue([
      { correctionId: 'c1', sessionId: 's1', segmentId: 'g1', userId: 'u1', correctionType: 'TEXT', beforeText: '', afterText: '', createdAt: RECENT },
    ]);
    vi.mocked(correctionRepo.getLastCorrectionAt).mockResolvedValue(RECENT);

    const result = await listUserSessions(leader, 'u1', NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sessionId: 's1',
      correctedSegments: 1,
      totalSegments: 2,
      progressPercent: 50,
      assignedTeamName: 'Team 1',
    });
  });
});
