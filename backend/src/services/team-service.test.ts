import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTeams,
  createNewTeam,
  updateExistingTeam,
  deleteExistingTeam,
  listTeamMembers,
  addMemberToTeam,
  removeMemberFromTeam,
  listAssignments,
  createAssignment,
  deleteAssignment,
  createUserReviewAssignment,
} from './team-service.js';
import { AppError } from '../utils/error-handler.js';

vi.mock('../repositories/team-repository.js', () => ({
  getTeamById: vi.fn(),
  getAllTeams: vi.fn(),
  getTeamsByUserId: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  deleteAllTeamAssignments: vi.fn(),
  deleteAllTeamMembers: vi.fn(),
  getTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  getTeamAssignments: vi.fn(),
  createTeamAssignment: vi.fn(),
  deleteTeamAssignment: vi.fn(),
  createReviewAssignment: vi.fn(),
  deleteReviewAssignment: vi.fn(),
  getReviewAssignmentsByUser: vi.fn(),
}));

vi.mock('./access-control-service.js', () => ({
  requireTeamAccess: vi.fn(),
  getUserTeamIds: vi.fn(),
  isTeamMember: vi.fn(),
}));

vi.mock('../repositories/user-repository.js', () => ({
  getUserById: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: () => 'generated-uuid',
}));

import { getUserById } from '../repositories/user-repository.js';
import {
  getTeamById,
  getAllTeams,
  getTeamsByUserId,
  createTeam,
  updateTeam,
  deleteTeam,
  deleteAllTeamAssignments,
  deleteAllTeamMembers,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  getTeamAssignments,
  createTeamAssignment,
  deleteTeamAssignment,
  createReviewAssignment,
  deleteReviewAssignment,
  getReviewAssignmentsByUser,
} from '../repositories/team-repository.js';
import {
  requireTeamAccess,
  getUserTeamIds,
  isTeamMember,
} from './access-control-service.js';

const mockedGetTeamById = vi.mocked(getTeamById);
const mockedGetAllTeams = vi.mocked(getAllTeams);
const mockedGetTeamsByUserId = vi.mocked(getTeamsByUserId);
const mockedCreateTeam = vi.mocked(createTeam);
const mockedUpdateTeam = vi.mocked(updateTeam);
const mockedDeleteTeam = vi.mocked(deleteTeam);
const mockedDeleteAllTeamAssignments = vi.mocked(deleteAllTeamAssignments);
const mockedDeleteAllTeamMembers = vi.mocked(deleteAllTeamMembers);
const mockedGetTeamMembers = vi.mocked(getTeamMembers);
const mockedAddTeamMember = vi.mocked(addTeamMember);
const mockedRemoveTeamMember = vi.mocked(removeTeamMember);
const mockedGetTeamAssignments = vi.mocked(getTeamAssignments);
const mockedCreateTeamAssignment = vi.mocked(createTeamAssignment);
const mockedDeleteTeamAssignment = vi.mocked(deleteTeamAssignment);
const mockedCreateReviewAssignment = vi.mocked(createReviewAssignment);
const mockedDeleteReviewAssignment = vi.mocked(deleteReviewAssignment);
const mockedGetReviewAssignmentsByUser = vi.mocked(getReviewAssignmentsByUser);
const mockedRequireTeamAccess = vi.mocked(requireTeamAccess);
const mockedGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockedIsTeamMember = vi.mocked(isTeamMember);
const mockedGetUserById = vi.mocked(getUserById);

const adminUser = { userId: 'admin-001', email: 'admin@test.com', displayName: 'Admin', role: 'ADMIN' as const };
const leaderUser = { userId: 'leader-001', email: 'leader@test.com', displayName: 'Leader', role: 'TEAM_LEADER' as const };
const reviewerUser = { userId: 'reviewer-001', email: 'reviewer@test.com', displayName: 'Reviewer', role: 'REVIEWER' as const };

const sampleTeam = {
  teamId: 'team-001',
  name: 'Test Team',
  createdBy: 'admin-001',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('Team Service - listTeams', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns all teams for ADMIN', async () => {
    mockedGetAllTeams.mockResolvedValue([sampleTeam]);
    const result = await listTeams(adminUser);
    expect(result).toHaveLength(1);
    expect(mockedGetAllTeams).toHaveBeenCalled();
  });

  it('returns only own teams for TEAM_LEADER', async () => {
    mockedGetTeamsByUserId.mockResolvedValue([sampleTeam]);
    const result = await listTeams(leaderUser);
    expect(result).toHaveLength(1);
    expect(mockedGetTeamsByUserId).toHaveBeenCalledWith('leader-001');
  });

  it('throws forbidden for REVIEWER', async () => {
    await expect(listTeams(reviewerUser)).rejects.toThrow(AppError);
    await expect(listTeams(reviewerUser)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('Team Service - listTeamMembers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enriches each member with displayName and email', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedGetTeamMembers.mockResolvedValue([
      { teamId: 'team-001', userId: 'user-001', createdAt: '2024-01-01T00:00:00.000Z' },
      { teamId: 'team-001', userId: 'user-002', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockedGetUserById.mockImplementation(async (userId: string) => {
      if (userId === 'user-001') {
        return { userId, email: 'a@test.com', displayName: 'Alice', role: 'REVIEWER', isActive: true, createdAt: '2024-01-01T00:00:00.000Z' } as never;
      }
      return { userId, email: 'b@test.com', displayName: 'Bob', role: 'REVIEWER', isActive: true, createdAt: '2024-01-01T00:00:00.000Z' } as never;
    });

    const result = await listTeamMembers(adminUser, 'team-001');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ userId: 'user-001', displayName: 'Alice', email: 'a@test.com' });
    expect(result[1]).toMatchObject({ userId: 'user-002', displayName: 'Bob', email: 'b@test.com' });
  });

  it('falls back gracefully when a user record is missing', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedGetTeamMembers.mockResolvedValue([
      { teamId: 'team-001', userId: 'ghost', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockedGetUserById.mockResolvedValue(null);

    const result = await listTeamMembers(adminUser, 'team-001');

    expect(result[0]).toMatchObject({ userId: 'ghost' });
    expect(result[0].displayName).toBeUndefined();
  });

  it('enforces team access before listing', async () => {
    mockedRequireTeamAccess.mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'x', statusCode: 404 })
    );

    await expect(listTeamMembers(adminUser, 'team-999')).rejects.toMatchObject({ statusCode: 404 });
    expect(mockedGetTeamMembers).not.toHaveBeenCalled();
  });
});

describe('Team Service - createNewTeam', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a team for ADMIN', async () => {
    mockedCreateTeam.mockResolvedValue(sampleTeam);
    const result = await createNewTeam(adminUser, { name: 'Test Team' });
    expect(result.teamId).toBe('team-001');
    expect(mockedCreateTeam).toHaveBeenCalledWith({
      teamId: 'generated-uuid',
      name: 'Test Team',
      createdBy: 'admin-001',
    });
  });

  it('adds TEAM_LEADER as member when they create a team', async () => {
    mockedCreateTeam.mockResolvedValue({ ...sampleTeam, createdBy: 'leader-001' });
    mockedAddTeamMember.mockResolvedValue({ teamId: 'generated-uuid', userId: 'leader-001', createdAt: '2024-01-01T00:00:00.000Z' });

    await createNewTeam(leaderUser, { name: 'My Team' });
    expect(mockedAddTeamMember).toHaveBeenCalledWith('generated-uuid', 'leader-001');
  });

  it('throws validation error for empty name', async () => {
    await expect(createNewTeam(adminUser, { name: '' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'チーム名は必須です。',
    });
  });

  it('throws validation error for whitespace-only name', async () => {
    await expect(createNewTeam(adminUser, { name: '   ' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('throws forbidden for REVIEWER', async () => {
    await expect(createNewTeam(reviewerUser, { name: 'Team' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('adds initial members if provided', async () => {
    mockedCreateTeam.mockResolvedValue(sampleTeam);
    mockedAddTeamMember.mockResolvedValue({ teamId: 'generated-uuid', userId: 'user-002', createdAt: '2024-01-01T00:00:00.000Z' });

    await createNewTeam(adminUser, { name: 'Team', members: ['user-002', 'user-003'] });
    expect(mockedAddTeamMember).toHaveBeenCalledWith('generated-uuid', 'user-002');
    expect(mockedAddTeamMember).toHaveBeenCalledWith('generated-uuid', 'user-003');
  });
});

describe('Team Service - updateExistingTeam', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates a team for ADMIN', async () => {
    mockedGetTeamById.mockResolvedValue(sampleTeam);
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedUpdateTeam.mockResolvedValue({ ...sampleTeam, name: 'Updated' });

    const result = await updateExistingTeam(adminUser, 'team-001', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('throws not found when team does not exist', async () => {
    mockedGetTeamById.mockResolvedValue(null);
    await expect(updateExistingTeam(adminUser, 'nonexistent', { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'チームが見つかりません。',
    });
  });

  it('enforces team access for TEAM_LEADER (Req 13.9)', async () => {
    mockedGetTeamById.mockResolvedValue(sampleTeam);
    mockedRequireTeamAccess.mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'リソースが見つかりません。', statusCode: 404 })
    );

    await expect(updateExistingTeam(leaderUser, 'team-001', { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Team Service - deleteExistingTeam', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes team with cascade for ADMIN (Req 13.10)', async () => {
    mockedGetTeamById.mockResolvedValue(sampleTeam);
    mockedGetTeamMembers.mockResolvedValue([
      { teamId: 'team-001', userId: 'user-001', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockedDeleteAllTeamAssignments.mockResolvedValue(undefined);
    mockedDeleteAllTeamMembers.mockResolvedValue(undefined);
    mockedDeleteTeam.mockResolvedValue(undefined);
    mockedGetUserTeamIds.mockResolvedValue([]); // user has no other teams
    mockedGetReviewAssignmentsByUser.mockResolvedValue([
      { userId: 'user-001', sessionId: 'session-001', createdBy: 'admin-001', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockedDeleteReviewAssignment.mockResolvedValue(undefined);

    await deleteExistingTeam(adminUser, 'team-001');

    expect(mockedDeleteAllTeamAssignments).toHaveBeenCalledWith('team-001');
    expect(mockedDeleteAllTeamMembers).toHaveBeenCalledWith('team-001');
    expect(mockedDeleteTeam).toHaveBeenCalledWith('team-001');
    // Membership loss revocation
    expect(mockedDeleteReviewAssignment).toHaveBeenCalledWith('user-001', 'session-001');
  });

  it('does not revoke ReviewAssignments if user still has other teams', async () => {
    mockedGetTeamById.mockResolvedValue(sampleTeam);
    mockedGetTeamMembers.mockResolvedValue([
      { teamId: 'team-001', userId: 'user-001', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockedDeleteAllTeamAssignments.mockResolvedValue(undefined);
    mockedDeleteAllTeamMembers.mockResolvedValue(undefined);
    mockedDeleteTeam.mockResolvedValue(undefined);
    mockedGetUserTeamIds.mockResolvedValue(['team-002']); // user still in another team

    await deleteExistingTeam(adminUser, 'team-001');

    expect(mockedGetReviewAssignmentsByUser).not.toHaveBeenCalled();
    expect(mockedDeleteReviewAssignment).not.toHaveBeenCalled();
  });

  it('throws forbidden for TEAM_LEADER', async () => {
    await expect(deleteExistingTeam(leaderUser, 'team-001')).rejects.toMatchObject({
      statusCode: 403,
      message: 'チームの削除はAdmin権限が必要です。',
    });
  });

  it('throws not found when team does not exist', async () => {
    mockedGetTeamById.mockResolvedValue(null);
    await expect(deleteExistingTeam(adminUser, 'nonexistent')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('cascade order: assignments → members → team', async () => {
    const callOrder: string[] = [];
    mockedGetTeamById.mockResolvedValue(sampleTeam);
    mockedGetTeamMembers.mockResolvedValue([]);
    mockedDeleteAllTeamAssignments.mockImplementation(async () => { callOrder.push('assignments'); });
    mockedDeleteAllTeamMembers.mockImplementation(async () => { callOrder.push('members'); });
    mockedDeleteTeam.mockImplementation(async () => { callOrder.push('team'); });

    await deleteExistingTeam(adminUser, 'team-001');

    expect(callOrder).toEqual(['assignments', 'members', 'team']);
  });
});

describe('Team Service - removeMemberFromTeam (Req 13.8 membership loss)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('revokes ReviewAssignments when user loses all team memberships', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedRemoveTeamMember.mockResolvedValue(undefined);
    mockedGetUserTeamIds.mockResolvedValue([]); // no more teams
    mockedGetReviewAssignmentsByUser.mockResolvedValue([
      { userId: 'user-001', sessionId: 'session-001', createdBy: 'admin-001', createdAt: '2024-01-01T00:00:00.000Z' },
      { userId: 'user-001', sessionId: 'session-002', createdBy: 'admin-001', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockedDeleteReviewAssignment.mockResolvedValue(undefined);

    await removeMemberFromTeam(adminUser, 'team-001', 'user-001');

    expect(mockedRemoveTeamMember).toHaveBeenCalledWith('team-001', 'user-001');
    expect(mockedDeleteReviewAssignment).toHaveBeenCalledWith('user-001', 'session-001');
    expect(mockedDeleteReviewAssignment).toHaveBeenCalledWith('user-001', 'session-002');
  });

  it('does not revoke ReviewAssignments when user still has other teams', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedRemoveTeamMember.mockResolvedValue(undefined);
    mockedGetUserTeamIds.mockResolvedValue(['team-002']); // still in another team

    await removeMemberFromTeam(adminUser, 'team-001', 'user-001');

    expect(mockedGetReviewAssignmentsByUser).not.toHaveBeenCalled();
    expect(mockedDeleteReviewAssignment).not.toHaveBeenCalled();
  });

  it('enforces team access for TEAM_LEADER (Req 13.9)', async () => {
    mockedRequireTeamAccess.mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'リソースが見つかりません。', statusCode: 404 })
    );

    await expect(removeMemberFromTeam(leaderUser, 'team-001', 'user-001')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Team Service - createAssignment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a TeamAssignment (Req 13.4)', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedCreateTeamAssignment.mockResolvedValue({
      teamId: 'team-001',
      sessionId: 'session-001',
      createdBy: 'admin-001',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await createAssignment(adminUser, 'team-001', 'session-001');
    expect(result.sessionId).toBe('session-001');
  });

  it('throws validation error for empty sessionId', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    await expect(createAssignment(adminUser, 'team-001', '')).rejects.toMatchObject({
      statusCode: 400,
      message: 'セッションIDは必須です。',
    });
  });

  it('enforces team access for TEAM_LEADER creating assignment (Req 13.9)', async () => {
    mockedRequireTeamAccess.mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'リソースが見つかりません。', statusCode: 404 })
    );

    await expect(createAssignment(leaderUser, 'other-team', 'session-001')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Team Service - deleteAssignment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes a TeamAssignment (Req 13.5)', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedDeleteTeamAssignment.mockResolvedValue(undefined);

    await deleteAssignment(adminUser, 'team-001', 'session-001');
    expect(mockedDeleteTeamAssignment).toHaveBeenCalledWith('team-001', 'session-001');
  });

  it('enforces team access for TEAM_LEADER deleting assignment (Req 13.9)', async () => {
    mockedRequireTeamAccess.mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'リソースが見つかりません。', statusCode: 404 })
    );

    await expect(deleteAssignment(leaderUser, 'other-team', 'session-001')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws validation error for empty sessionId', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    await expect(deleteAssignment(adminUser, 'team-001', '')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('Team Service - deleteExistingTeam cascade with multiple members (Req 13.10, 13.8)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('revokes ReviewAssignments for all orphaned members during team deletion', async () => {
    mockedGetTeamById.mockResolvedValue(sampleTeam);
    mockedGetTeamMembers.mockResolvedValue([
      { teamId: 'team-001', userId: 'user-001', createdAt: '2024-01-01T00:00:00.000Z' },
      { teamId: 'team-001', userId: 'user-002', createdAt: '2024-01-01T00:00:00.000Z' },
      { teamId: 'team-001', userId: 'user-003', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockedDeleteAllTeamAssignments.mockResolvedValue(undefined);
    mockedDeleteAllTeamMembers.mockResolvedValue(undefined);
    mockedDeleteTeam.mockResolvedValue(undefined);

    // user-001: orphaned (no other teams)
    // user-002: still in another team
    // user-003: orphaned (no other teams)
    mockedGetUserTeamIds
      .mockResolvedValueOnce([])        // user-001: no teams
      .mockResolvedValueOnce(['team-002']) // user-002: still in team-002
      .mockResolvedValueOnce([]);        // user-003: no teams

    mockedGetReviewAssignmentsByUser
      .mockResolvedValueOnce([
        { userId: 'user-001', sessionId: 'session-A', createdBy: 'admin-001', createdAt: '2024-01-01T00:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        { userId: 'user-003', sessionId: 'session-B', createdBy: 'admin-001', createdAt: '2024-01-01T00:00:00.000Z' },
      ]);
    mockedDeleteReviewAssignment.mockResolvedValue(undefined);

    await deleteExistingTeam(adminUser, 'team-001');

    // user-001's ReviewAssignment revoked
    expect(mockedDeleteReviewAssignment).toHaveBeenCalledWith('user-001', 'session-A');
    // user-003's ReviewAssignment revoked
    expect(mockedDeleteReviewAssignment).toHaveBeenCalledWith('user-003', 'session-B');
    // user-002 was NOT checked for ReviewAssignments (still has a team)
    expect(mockedDeleteReviewAssignment).toHaveBeenCalledTimes(2);
  });
});

describe('Team Service - createUserReviewAssignment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a ReviewAssignment for a team member (Req 13.8)', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedIsTeamMember.mockResolvedValue(true);
    mockedCreateReviewAssignment.mockResolvedValue({
      userId: 'user-001',
      sessionId: 'session-001',
      createdBy: 'admin-001',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await createUserReviewAssignment(adminUser, 'team-001', 'user-001', 'session-001');
    expect(result.userId).toBe('user-001');
    expect(mockedIsTeamMember).toHaveBeenCalledWith('user-001', 'team-001');
  });

  it('rejects when target user is not a team member', async () => {
    mockedRequireTeamAccess.mockResolvedValue(undefined);
    mockedIsTeamMember.mockResolvedValue(false);

    await expect(
      createUserReviewAssignment(adminUser, 'team-001', 'user-999', 'session-001')
    ).rejects.toMatchObject({
      statusCode: 403,
      message: '対象ユーザーはこのチームのメンバーではありません。',
    });
  });

  it('throws validation error for empty userId', async () => {
    await expect(
      createUserReviewAssignment(adminUser, 'team-001', '', 'session-001')
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'ユーザーIDは必須です。',
    });
  });

  it('throws validation error for empty sessionId', async () => {
    await expect(
      createUserReviewAssignment(adminUser, 'team-001', 'user-001', '')
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'セッションIDは必須です。',
    });
  });
});
