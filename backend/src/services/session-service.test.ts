import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  changeSessionStatus,
  createSessionForJob,
  isValidStatus,
  getAssignedSessions,
  assignSession,
  joinSession,
  selfAssignSession,
  listJoinableSessions,
  addSpeakerLabel,
  deleteSpeakerLabel,
  reopenSession,
} from './session-service.js';
import type { AuthUser } from '../utils/auth-middleware.js';

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
  updateSessionStatus: vi.fn(),
  createSession: vi.fn(),
  getSessionsByParticipantUserId: vi.fn(),
  getSessionsByTeamId: vi.fn(),
  getAllSessions: vi.fn(),
  getSessionIdsByParticipantUserId: vi.fn(),
  updateSessionAssignment: vi.fn(),
  addParticipant: vi.fn(),
  updateSessionSpeakerLabels: vi.fn(),
  getSegmentSpeakerLabels: vi.fn(),
  // sortByCreatedAtDesc is a pure helper; use the real implementation.
  sortByCreatedAtDesc: (sessions: unknown[]) =>
    [...(sessions as { createdAt: string }[])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
}));

vi.mock('./access-control-service.js', () => ({
  getUserTeamIds: vi.fn(),
  isTeamMember: vi.fn(),
}));

import {
  getSessionById,
  updateSessionStatus,
  createSession,
  getSessionsByParticipantUserId,
  getSessionsByTeamId,
  getAllSessions,
  getSessionIdsByParticipantUserId,
  updateSessionAssignment,
  addParticipant,
  updateSessionSpeakerLabels,
  getSegmentSpeakerLabels,
} from '../repositories/session-repository.js';
import { getUserTeamIds, isTeamMember } from './access-control-service.js';

const mockedGetSessionById = vi.mocked(getSessionById);
const mockedUpdateSessionStatus = vi.mocked(updateSessionStatus);
const mockedCreateSession = vi.mocked(createSession);
const mockedGetSessionsByParticipantUserId = vi.mocked(getSessionsByParticipantUserId);
const mockedGetSessionsByTeamId = vi.mocked(getSessionsByTeamId);
const mockedGetAllSessions = vi.mocked(getAllSessions);
const mockedGetSessionIdsByParticipantUserId = vi.mocked(getSessionIdsByParticipantUserId);
const mockedUpdateSessionAssignment = vi.mocked(updateSessionAssignment);
const mockedAddParticipant = vi.mocked(addParticipant);
const mockedGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockedIsTeamMember = vi.mocked(isTeamMember);
const mockedUpdateSessionSpeakerLabels = vi.mocked(updateSessionSpeakerLabels);
const mockedGetSegmentSpeakerLabels = vi.mocked(getSegmentSpeakerLabels);

const reviewer: AuthUser = {
  userId: 'reviewer-001',
  email: 'reviewer@example.com',
  displayName: 'Reviewer',
  role: 'REVIEWER',
};
const teamLeader: AuthUser = {
  userId: 'leader-001',
  email: 'leader@example.com',
  displayName: 'Leader',
  role: 'TEAM_LEADER',
};
const admin: AuthUser = {
  userId: 'admin-001',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'ADMIN',
};

const unassignedSession = {
  sessionId: 'session-100',
  name: 'Unassigned',
  status: 'PENDING' as const,
  assignedTeamId: 'team-001',
  assignedReviewerCount: 0,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const sampleSession = {
  sessionId: 'session-001',
  name: 'Meeting Transcription',
  status: 'PENDING' as const,
  assignedReviewerCount: 3,
  consensusThreshold: 67,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('session-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidStatus', () => {
    it('returns true for PENDING', () => {
      expect(isValidStatus('PENDING')).toBe(true);
    });

    it('returns true for IN_PROGRESS', () => {
      expect(isValidStatus('IN_PROGRESS')).toBe(true);
    });

    it('returns true for COMPLETED', () => {
      expect(isValidStatus('COMPLETED')).toBe(true);
    });

    it('returns false for invalid status', () => {
      expect(isValidStatus('INVALID')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidStatus('')).toBe(false);
    });
  });

  describe('changeSessionStatus', () => {
    it('updates status from PENDING to IN_PROGRESS', async () => {
      mockedGetSessionById.mockResolvedValue(sampleSession);
      mockedUpdateSessionStatus.mockResolvedValue({
        ...sampleSession,
        status: 'IN_PROGRESS',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = await changeSessionStatus('session-001', 'IN_PROGRESS');

      expect(result.status).toBe('IN_PROGRESS');
      expect(mockedUpdateSessionStatus).toHaveBeenCalledWith('session-001', 'IN_PROGRESS');
    });

    it('updates status from PENDING to COMPLETED', async () => {
      mockedGetSessionById.mockResolvedValue(sampleSession);
      mockedUpdateSessionStatus.mockResolvedValue({
        ...sampleSession,
        status: 'COMPLETED',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = await changeSessionStatus('session-001', 'COMPLETED');

      expect(result.status).toBe('COMPLETED');
      expect(mockedUpdateSessionStatus).toHaveBeenCalledWith('session-001', 'COMPLETED');
    });

    it('updates status from IN_PROGRESS to COMPLETED', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...sampleSession,
        status: 'IN_PROGRESS',
      });
      mockedUpdateSessionStatus.mockResolvedValue({
        ...sampleSession,
        status: 'COMPLETED',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = await changeSessionStatus('session-001', 'COMPLETED');

      expect(result.status).toBe('COMPLETED');
    });

    it('throws validation error for invalid status value', async () => {
      await expect(
        changeSessionStatus('session-001', 'INVALID')
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });

      expect(mockedGetSessionById).not.toHaveBeenCalled();
    });

    it('throws validation error when session is not found', async () => {
      mockedGetSessionById.mockResolvedValue(null);

      await expect(
        changeSessionStatus('session-999', 'COMPLETED')
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('見つかりません'),
      });
    });

    it('throws validation error for disallowed transition COMPLETED -> IN_PROGRESS', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...sampleSession,
        status: 'COMPLETED',
      });

      await expect(
        changeSessionStatus('session-001', 'IN_PROGRESS')
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('変更はできません'),
      });

      expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
    });

    it('throws validation error for disallowed transition IN_PROGRESS -> PENDING', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...sampleSession,
        status: 'IN_PROGRESS',
      });

      await expect(
        changeSessionStatus('session-001', 'PENDING')
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('変更はできません'),
      });
    });
  });

  describe('createSessionForJob', () => {
    it('creates a new session with PENDING status for a transcription job', async () => {
      mockedCreateSession.mockResolvedValue({
        sessionId: 'generated-uuid',
        name: 'Test Job',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await createSessionForJob('job-001', 'Test Job');

      expect(result.status).toBe('PENDING');
      expect(result.name).toBe('Test Job');
      expect(mockedCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.any(String),
          transcriptionJobId: 'job-001',
          name: 'Test Job',
        })
      );
    });

    it('creates a session with teamId when provided', async () => {
      mockedCreateSession.mockResolvedValue({
        sessionId: 'generated-uuid',
        name: 'Team Job',
        status: 'PENDING',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await createSessionForJob('job-002', 'Team Job', 'team-001');

      expect(mockedCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          transcriptionJobId: 'job-002',
          name: 'Team Job',
          teamId: 'team-001',
        })
      );
    });

    it('assigns the session to the uploader when assignedUserId is provided', async () => {
      mockedCreateSession.mockResolvedValue({
        sessionId: 'generated-uuid',
        name: 'Admin Upload',
        status: 'PENDING',
        assignedUserId: 'admin-001',
        assignedReviewerCount: 0,
        consensusThreshold: 67,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await createSessionForJob(
        'job-003',
        'Admin Upload',
        'team-001',
        'admin-001'
      );

      expect(result.assignedUserId).toBe('admin-001');
      expect(mockedCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          transcriptionJobId: 'job-003',
          name: 'Admin Upload',
          teamId: 'team-001',
          assignedUserId: 'admin-001',
        })
      );
    });
  });

  describe('getAssignedSessions', () => {
    it('returns the sessions the user participates in, sorted by createdAt descending', async () => {
      mockedGetSessionsByParticipantUserId.mockResolvedValue([
        { ...unassignedSession, sessionId: 's-old', createdAt: '2024-01-01T00:00:00.000Z' },
        { ...unassignedSession, sessionId: 's-new', createdAt: '2024-03-01T00:00:00.000Z' },
      ]);

      const result = await getAssignedSessions('reviewer-001');

      expect(mockedGetSessionsByParticipantUserId).toHaveBeenCalledWith('reviewer-001');
      expect(result.map((s) => s.sessionId)).toEqual(['s-new', 's-old']);
    });
  });

  describe('assignSession', () => {
    it('rejects a REVIEWER (403)', async () => {
      await expect(
        assignSession(reviewer, 'session-100', { assignedUserId: 'x' })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockedUpdateSessionAssignment).not.toHaveBeenCalled();
    });

    it('rejects when neither target is provided (400)', async () => {
      await expect(
        assignSession(admin, 'session-100', {})
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 404 when the session does not exist', async () => {
      mockedGetSessionById.mockResolvedValue(null);
      await expect(
        assignSession(admin, 'missing', { assignedUserId: 'u' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lets ADMIN assign to any user', async () => {
      mockedGetSessionById.mockResolvedValue(unassignedSession);
      mockedUpdateSessionAssignment.mockResolvedValue({
        ...unassignedSession,
        assignedUserId: 'someone',
      });

      const result = await assignSession(admin, 'session-100', {
        assignedUserId: 'someone',
      });

      expect(result.assignedUserId).toBe('someone');
      expect(mockedUpdateSessionAssignment).toHaveBeenCalledWith('session-100', {
        assignedUserId: 'someone',
        assignedTeamId: undefined,
      });
    });

    it('lets a TEAM_LEADER assign to a member of their own team', async () => {
      mockedGetSessionById.mockResolvedValue(unassignedSession);
      // leader teams and target-user teams both include team-001
      mockedGetUserTeamIds.mockImplementation(async (userId: string) =>
        userId === teamLeader.userId ? ['team-001'] : ['team-001']
      );
      mockedUpdateSessionAssignment.mockResolvedValue({
        ...unassignedSession,
        assignedUserId: 'member-1',
      });

      const result = await assignSession(teamLeader, 'session-100', {
        assignedUserId: 'member-1',
      });

      expect(result.assignedUserId).toBe('member-1');
    });

    it('forbids a TEAM_LEADER from assigning to a team they do not belong to', async () => {
      mockedGetSessionById.mockResolvedValue(unassignedSession);
      mockedGetUserTeamIds.mockResolvedValue(['team-001']);

      await expect(
        assignSession(teamLeader, 'session-100', { assignedTeamId: 'team-999' })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockedUpdateSessionAssignment).not.toHaveBeenCalled();
    });

    it('forbids a TEAM_LEADER from assigning to a user outside their teams', async () => {
      mockedGetSessionById.mockResolvedValue(unassignedSession);
      mockedGetUserTeamIds.mockImplementation(async (userId: string) =>
        userId === teamLeader.userId ? ['team-001'] : ['team-999']
      );

      await expect(
        assignSession(teamLeader, 'session-100', { assignedUserId: 'outsider' })
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('joinSession', () => {
    it('returns 404 when the session does not exist', async () => {
      mockedGetSessionById.mockResolvedValue(null);
      await expect(
        joinSession(reviewer, 'missing')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lets a team member join a team session and returns the refreshed session', async () => {
      mockedGetSessionById
        .mockResolvedValueOnce(unassignedSession)
        .mockResolvedValueOnce({
          ...unassignedSession,
          assignedReviewerCount: 1,
        });
      mockedIsTeamMember.mockResolvedValue(true);
      mockedAddParticipant.mockResolvedValue(true);

      const result = await joinSession(reviewer, 'session-100');

      expect(mockedIsTeamMember).toHaveBeenCalledWith(reviewer.userId, 'team-001');
      expect(mockedAddParticipant).toHaveBeenCalledWith('session-100', reviewer.userId);
      expect(result.assignedReviewerCount).toBe(1);
    });

    it('allows multiple reviewers to join the same session', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...unassignedSession,
        assignedReviewerCount: 2,
      });
      mockedIsTeamMember.mockResolvedValue(true);
      mockedAddParticipant.mockResolvedValue(true);

      const other: AuthUser = { ...reviewer, userId: 'reviewer-002' };
      const result = await joinSession(other, 'session-100');

      expect(mockedAddParticipant).toHaveBeenCalledWith('session-100', 'reviewer-002');
      expect(result.assignedReviewerCount).toBe(2);
    });

    it('forbids joining when the reviewer is not in the session team (403)', async () => {
      mockedGetSessionById.mockResolvedValue(unassignedSession);
      mockedIsTeamMember.mockResolvedValue(false);

      await expect(
        joinSession(reviewer, 'session-100')
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockedAddParticipant).not.toHaveBeenCalled();
    });

    it('is idempotent when the reviewer already joined (no re-fetch, no double count)', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...unassignedSession,
        assignedReviewerCount: 1,
      });
      mockedIsTeamMember.mockResolvedValue(true);
      mockedAddParticipant.mockResolvedValue(false);

      const result = await joinSession(reviewer, 'session-100');

      expect(mockedAddParticipant).toHaveBeenCalledWith('session-100', reviewer.userId);
      // Only the initial getSessionById call — no refresh needed on idempotent re-join.
      expect(mockedGetSessionById).toHaveBeenCalledTimes(1);
      expect(result.assignedReviewerCount).toBe(1);
    });

    it('lets ADMIN join any session regardless of team', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...unassignedSession,
        assignedTeamId: undefined,
      });
      mockedAddParticipant.mockResolvedValue(true);

      const result = await joinSession(admin, 'session-100');

      expect(mockedIsTeamMember).not.toHaveBeenCalled();
      expect(mockedAddParticipant).toHaveBeenCalledWith('session-100', admin.userId);
      expect(result.sessionId).toBe('session-100');
    });
  });

  describe('selfAssignSession', () => {
    it('returns 404 when the session does not exist', async () => {
      mockedGetSessionById.mockResolvedValue(null);
      await expect(
        selfAssignSession(reviewer, 'missing')
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(mockedAddParticipant).not.toHaveBeenCalled();
    });

    it('forbids a REVIEWER when the session has no assignedTeamId (403)', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...unassignedSession,
        assignedTeamId: undefined,
      });

      await expect(
        selfAssignSession(reviewer, 'session-100')
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(mockedAddParticipant).not.toHaveBeenCalled();
    });

    it('forbids a REVIEWER who is not a member of the session team (403)', async () => {
      mockedGetSessionById.mockResolvedValue(unassignedSession);
      mockedIsTeamMember.mockResolvedValue(false);

      await expect(
        selfAssignSession(reviewer, 'session-100')
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(mockedIsTeamMember).toHaveBeenCalledWith(reviewer.userId, 'team-001');
      expect(mockedAddParticipant).not.toHaveBeenCalled();
    });

    it('lets a team member self-assign and returns the refreshed session', async () => {
      mockedGetSessionById
        .mockResolvedValueOnce(unassignedSession)
        .mockResolvedValueOnce({
          ...unassignedSession,
          assignedReviewerCount: 1,
        });
      mockedIsTeamMember.mockResolvedValue(true);
      mockedAddParticipant.mockResolvedValue(true);

      const result = await selfAssignSession(reviewer, 'session-100');

      expect(mockedIsTeamMember).toHaveBeenCalledWith(reviewer.userId, 'team-001');
      expect(mockedAddParticipant).toHaveBeenCalledWith('session-100', reviewer.userId);
      expect(result.assignedReviewerCount).toBe(1);
    });

    it('lets ADMIN self-assign any session regardless of team', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...unassignedSession,
        assignedTeamId: undefined,
      });
      mockedAddParticipant.mockResolvedValue(true);

      const result = await selfAssignSession(admin, 'session-100');

      expect(mockedIsTeamMember).not.toHaveBeenCalled();
      expect(mockedAddParticipant).toHaveBeenCalledWith('session-100', admin.userId);
      expect(result.sessionId).toBe('session-100');
    });

    it('is idempotent when the reviewer already self-assigned (no re-fetch, no double count)', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...unassignedSession,
        assignedReviewerCount: 1,
      });
      mockedIsTeamMember.mockResolvedValue(true);
      mockedAddParticipant.mockResolvedValue(false);

      const result = await selfAssignSession(reviewer, 'session-100');

      expect(mockedAddParticipant).toHaveBeenCalledWith('session-100', reviewer.userId);
      // Only the initial getSessionById call — no refresh on idempotent re-join.
      expect(mockedGetSessionById).toHaveBeenCalledTimes(1);
      expect(result.assignedReviewerCount).toBe(1);
    });
  });

  describe('listJoinableSessions', () => {
    const pendingTeam1 = {
      ...unassignedSession,
      sessionId: 's-pending-1',
      assignedTeamId: 'team-001',
      status: 'PENDING' as const,
      createdAt: '2024-03-01T00:00:00.000Z',
    };
    const pendingTeam1Older = {
      ...unassignedSession,
      sessionId: 's-pending-2',
      assignedTeamId: 'team-001',
      status: 'PENDING' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    const inProgressTeam1 = {
      ...unassignedSession,
      sessionId: 's-inprogress',
      assignedTeamId: 'team-001',
      status: 'IN_PROGRESS' as const,
      createdAt: '2024-02-01T00:00:00.000Z',
    };

    it('returns PENDING team sessions the reviewer has not joined, sorted by createdAt desc', async () => {
      mockedGetUserTeamIds.mockResolvedValue(['team-001']);
      mockedGetSessionsByTeamId.mockResolvedValue([
        pendingTeam1,
        pendingTeam1Older,
        inProgressTeam1,
      ]);
      mockedGetSessionIdsByParticipantUserId.mockResolvedValue([]);

      const result = await listJoinableSessions(reviewer);

      expect(mockedGetUserTeamIds).toHaveBeenCalledWith(reviewer.userId);
      expect(result.map((s) => s.sessionId)).toEqual(['s-pending-1', 's-pending-2']);
    });

    it('excludes non-PENDING sessions', async () => {
      mockedGetUserTeamIds.mockResolvedValue(['team-001']);
      mockedGetSessionsByTeamId.mockResolvedValue([inProgressTeam1]);
      mockedGetSessionIdsByParticipantUserId.mockResolvedValue([]);

      const result = await listJoinableSessions(reviewer);

      expect(result).toEqual([]);
    });

    it('excludes sessions the reviewer already participates in', async () => {
      mockedGetUserTeamIds.mockResolvedValue(['team-001']);
      mockedGetSessionsByTeamId.mockResolvedValue([pendingTeam1, pendingTeam1Older]);
      mockedGetSessionIdsByParticipantUserId.mockResolvedValue(['s-pending-1']);

      const result = await listJoinableSessions(reviewer);

      expect(result.map((s) => s.sessionId)).toEqual(['s-pending-2']);
    });

    it('returns an empty array when the reviewer belongs to no team', async () => {
      mockedGetUserTeamIds.mockResolvedValue([]);
      mockedGetSessionIdsByParticipantUserId.mockResolvedValue([]);

      const result = await listJoinableSessions(reviewer);

      expect(result).toEqual([]);
      expect(mockedGetSessionsByTeamId).not.toHaveBeenCalled();
      expect(mockedGetAllSessions).not.toHaveBeenCalled();
    });

    it('de-dups a session that appears across multiple teams', async () => {
      mockedGetUserTeamIds.mockResolvedValue(['team-001', 'team-002']);
      mockedGetSessionsByTeamId.mockImplementation(async () => [pendingTeam1]);
      mockedGetSessionIdsByParticipantUserId.mockResolvedValue([]);

      const result = await listJoinableSessions(reviewer);

      expect(result.map((s) => s.sessionId)).toEqual(['s-pending-1']);
    });

    it('uses getAllSessions for ADMIN and still excludes joined/non-PENDING', async () => {
      mockedGetAllSessions.mockResolvedValue([
        pendingTeam1,
        pendingTeam1Older,
        inProgressTeam1,
      ]);
      mockedGetSessionIdsByParticipantUserId.mockResolvedValue(['s-pending-2']);

      const result = await listJoinableSessions(admin);

      expect(mockedGetAllSessions).toHaveBeenCalledTimes(1);
      expect(mockedGetUserTeamIds).not.toHaveBeenCalled();
      expect(result.map((s) => s.sessionId)).toEqual(['s-pending-1']);
    });
  });

  describe('addSpeakerLabel', () => {
    const sessionWithLabels = {
      ...sampleSession,
      speakerLabels: ['spk_0'],
    };

    it('appends a new label to the master list', async () => {
      mockedGetSessionById.mockResolvedValue(sessionWithLabels);
      mockedGetSegmentSpeakerLabels.mockResolvedValue(['spk_0']);
      mockedUpdateSessionSpeakerLabels.mockResolvedValue({
        ...sessionWithLabels,
        speakerLabels: ['spk_0', 'spk_1'],
      });

      const result = await addSpeakerLabel('session-001', 'spk_1');

      expect(mockedUpdateSessionSpeakerLabels).toHaveBeenCalledWith('session-001', [
        'spk_0',
        'spk_1',
      ]);
      expect(result.speakerLabels).toEqual(['spk_0', 'spk_1']);
    });

    it('trims the raw label before saving', async () => {
      mockedGetSessionById.mockResolvedValue(sessionWithLabels);
      mockedGetSegmentSpeakerLabels.mockResolvedValue([]);
      mockedUpdateSessionSpeakerLabels.mockResolvedValue(sessionWithLabels);

      await addSpeakerLabel('session-001', '  田中  ');

      expect(mockedUpdateSessionSpeakerLabels).toHaveBeenCalledWith('session-001', [
        'spk_0',
        '田中',
      ]);
    });

    it('rejects an empty (whitespace-only) label with 400', async () => {
      await expect(
        addSpeakerLabel('session-001', '   ')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedGetSessionById).not.toHaveBeenCalled();
    });

    it('rejects a label duplicated in the master list with 400', async () => {
      mockedGetSessionById.mockResolvedValue(sessionWithLabels);
      mockedGetSegmentSpeakerLabels.mockResolvedValue([]);

      await expect(
        addSpeakerLabel('session-001', 'spk_0')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedUpdateSessionSpeakerLabels).not.toHaveBeenCalled();
    });

    it('rejects a label duplicated in the segment-derived labels with 400', async () => {
      mockedGetSessionById.mockResolvedValue({ ...sampleSession, speakerLabels: [] });
      mockedGetSegmentSpeakerLabels.mockResolvedValue(['spk_9']);

      await expect(
        addSpeakerLabel('session-001', 'spk_9')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedUpdateSessionSpeakerLabels).not.toHaveBeenCalled();
    });

    it('returns 404 when the session does not exist', async () => {
      mockedGetSessionById.mockResolvedValue(null);

      await expect(
        addSpeakerLabel('missing', 'spk_1')
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('rejects adding a label to a COMPLETED session with 400', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...sessionWithLabels,
        status: 'COMPLETED',
      });

      await expect(
        addSpeakerLabel('session-001', 'spk_1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedUpdateSessionSpeakerLabels).not.toHaveBeenCalled();
    });
  });

  describe('deleteSpeakerLabel', () => {
    const sessionWithLabels = {
      ...sampleSession,
      speakerLabels: ['spk_0', 'spk_1'],
    };

    it('removes an unused label from the master list', async () => {
      mockedGetSessionById.mockResolvedValue(sessionWithLabels);
      mockedGetSegmentSpeakerLabels.mockResolvedValue(['spk_0']);
      mockedUpdateSessionSpeakerLabels.mockResolvedValue({
        ...sessionWithLabels,
        speakerLabels: ['spk_0'],
      });

      const result = await deleteSpeakerLabel('session-001', 'spk_1');

      expect(mockedUpdateSessionSpeakerLabels).toHaveBeenCalledWith('session-001', [
        'spk_0',
      ]);
      expect(result.speakerLabels).toEqual(['spk_0']);
    });

    it('rejects deleting a label that is in use by a segment with 400', async () => {
      mockedGetSessionById.mockResolvedValue(sessionWithLabels);
      mockedGetSegmentSpeakerLabels.mockResolvedValue(['spk_0', 'spk_1']);

      await expect(
        deleteSpeakerLabel('session-001', 'spk_0')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedUpdateSessionSpeakerLabels).not.toHaveBeenCalled();
    });

    it('returns 404 when the label is not in the master list', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...sampleSession,
        speakerLabels: ['spk_0'],
      });
      mockedGetSegmentSpeakerLabels.mockResolvedValue([]);

      await expect(
        deleteSpeakerLabel('session-001', 'spk_unknown')
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(mockedUpdateSessionSpeakerLabels).not.toHaveBeenCalled();
    });

    it('returns 404 when the session does not exist', async () => {
      mockedGetSessionById.mockResolvedValue(null);

      await expect(
        deleteSpeakerLabel('missing', 'spk_0')
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('rejects deleting a label on a COMPLETED session with 400', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...sessionWithLabels,
        status: 'COMPLETED',
      });

      await expect(
        deleteSpeakerLabel('session-001', 'spk_1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedUpdateSessionSpeakerLabels).not.toHaveBeenCalled();
    });
  });

  describe('reopenSession', () => {
    const completedTeamSession = {
      ...unassignedSession,
      status: 'COMPLETED' as const,
      assignedTeamId: 'team-001',
    };

    it('rejects a REVIEWER (403)', async () => {
      await expect(
        reopenSession(reviewer, 'session-100')
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockedGetSessionById).not.toHaveBeenCalled();
      expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
    });

    it('lets a TEAM_LEADER reopen a COMPLETED session in their own team', async () => {
      mockedGetSessionById.mockResolvedValue(completedTeamSession);
      mockedIsTeamMember.mockResolvedValue(true);
      mockedUpdateSessionStatus.mockResolvedValue({
        ...completedTeamSession,
        status: 'IN_PROGRESS',
      });

      const result = await reopenSession(teamLeader, 'session-100');

      expect(mockedIsTeamMember).toHaveBeenCalledWith('leader-001', 'team-001');
      expect(mockedUpdateSessionStatus).toHaveBeenCalledWith(
        'session-100',
        'IN_PROGRESS'
      );
      // Policy A: only updateSessionStatus runs — no consensus/segment writes.
      expect(mockedUpdateSessionStatus).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('forbids a TEAM_LEADER from reopening another team session (403)', async () => {
      mockedGetSessionById.mockResolvedValue(completedTeamSession);
      mockedIsTeamMember.mockResolvedValue(false);

      await expect(
        reopenSession(teamLeader, 'session-100')
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
    });

    it('lets ADMIN reopen any COMPLETED session', async () => {
      mockedGetSessionById.mockResolvedValue(completedTeamSession);
      mockedUpdateSessionStatus.mockResolvedValue({
        ...completedTeamSession,
        status: 'IN_PROGRESS',
      });

      const result = await reopenSession(admin, 'session-100');

      expect(mockedIsTeamMember).not.toHaveBeenCalled();
      expect(mockedUpdateSessionStatus).toHaveBeenCalledWith(
        'session-100',
        'IN_PROGRESS'
      );
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('rejects reopening a PENDING session (400)', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...completedTeamSession,
        status: 'PENDING',
      });

      await expect(
        reopenSession(admin, 'session-100')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
    });

    it('rejects reopening an IN_PROGRESS session (400)', async () => {
      mockedGetSessionById.mockResolvedValue({
        ...completedTeamSession,
        status: 'IN_PROGRESS',
      });

      await expect(
        reopenSession(admin, 'session-100')
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when the session does not exist', async () => {
      mockedGetSessionById.mockResolvedValue(null);

      await expect(
        reopenSession(admin, 'missing')
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(mockedUpdateSessionStatus).not.toHaveBeenCalled();
    });
  });
});
