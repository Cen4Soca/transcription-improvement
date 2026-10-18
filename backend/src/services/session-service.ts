import { v4 as uuidv4 } from 'uuid';
import {
  validationError,
  notFoundError,
  forbiddenError,
} from '../utils/error-handler.js';
import { isAdmin, requireRole, type AuthUser } from '../utils/auth-middleware.js';
import { assertSessionEditable } from '../utils/session-guard.js';
import {
  getUserTeamIds,
  isTeamMember,
} from './access-control-service.js';
import {
  getSessionById,
  updateSessionStatus,
  updateSessionName,
  updateSessionAssignment,
  updateSessionSpeakerLabels,
  getSegmentSpeakerLabels,
  addParticipant,
  getSessionsByParticipantUserId,
  getSessionsByTeamId,
  getAllSessions,
  getSessionIdsByParticipantUserId,
  sortByCreatedAtDesc,
  createSession,
  type SessionRecord,
  type CreateSessionInput,
} from '../repositories/session-repository.js';

const VALID_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
type SessionStatus = (typeof VALID_STATUSES)[number];

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
};

/**
 * Validate that a status value is one of the allowed session statuses.
 */
export function isValidStatus(status: string): status is SessionStatus {
  return (VALID_STATUSES as readonly string[]).includes(status);
}

/**
 * Update the status of a ReviewSession.
 * Validates the status transition and updates the session in DynamoDB.
 *
 * @throws validationError if the status is invalid or the transition is not allowed
 */
export async function changeSessionStatus(
  sessionId: string,
  newStatus: string
): Promise<SessionRecord> {
  if (!isValidStatus(newStatus)) {
    throw validationError(
      'status は PENDING, IN_PROGRESS, COMPLETED のいずれかを指定してください。'
    );
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    throw validationError('指定されたセッションが見つかりません。');
  }

  const allowedTransitions = VALID_STATUS_TRANSITIONS[session.status] ?? [];
  if (!allowedTransitions.includes(newStatus)) {
    throw validationError(
      `現在のステータス「${session.status}」から「${newStatus}」への変更はできません。`
    );
  }

  return updateSessionStatus(sessionId, newStatus as SessionRecord['status']);
}

/**
 * Rename a ReviewSession.
 * Trims the raw name and enforces a 1–100 character length constraint, then
 * updates the session in DynamoDB.
 *
 * @throws validationError if the trimmed name is empty or out of the 1–100 range
 * @throws validationError if the session does not exist
 */
export async function renameSession(
  sessionId: string,
  rawName: string
): Promise<SessionRecord> {
  const name = rawName.trim();

  if (name.length === 0) {
    throw validationError('Session name is required.');
  }

  if (name.length < 1 || name.length > 100) {
    throw validationError('Session name must be between 1 and 100 characters.');
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    throw validationError('指定されたセッションが見つかりません。');
  }

  return updateSessionName(sessionId, name);
}

/**
 * Compute the full set of speaker labels for a session: the union of the
 * session's master list and the labels derived from its segments.
 */
function unionLabels(masterLabels: string[], segmentLabels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of [...masterLabels, ...segmentLabels]) {
    if (!seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }
  return result;
}

/**
 * Add a speaker label to a session's master list.
 * Trims the raw label, rejects an empty value, and rejects a label that already
 * exists in the union of the master list and the segment-derived labels.
 * Returns the updated session record.
 *
 * @throws validationError if the trimmed label is empty or already exists
 * @throws notFoundError if the session does not exist
 */
export async function addSpeakerLabel(
  sessionId: string,
  rawLabel: string
): Promise<SessionRecord> {
  const label = rawLabel.trim();

  if (label.length === 0) {
    throw validationError('Speaker label is required.');
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定されたセッションが見つかりません。');
  }
  assertSessionEditable(session);

  const masterLabels = session.speakerLabels ?? [];
  const segmentLabels = await getSegmentSpeakerLabels(sessionId);
  const existing = unionLabels(masterLabels, segmentLabels);

  if (existing.includes(label)) {
    throw validationError('Speaker label already exists.');
  }

  return updateSessionSpeakerLabels(sessionId, [...masterLabels, label]);
}

/**
 * Delete a speaker label from a session's master list.
 * Before deleting, verifies that the label is not assigned to any segment in
 * the session; a label still in use cannot be deleted. A label that exists on
 * segments but not in the master list is therefore always rejected as in use.
 * Returns the updated session record.
 *
 * @throws notFoundError if the session or the master label does not exist
 * @throws validationError if the label is still used by a segment
 */
export async function deleteSpeakerLabel(
  sessionId: string,
  label: string
): Promise<SessionRecord> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定されたセッションが見つかりません。');
  }
  assertSessionEditable(session);

  const segmentLabels = await getSegmentSpeakerLabels(sessionId);
  if (segmentLabels.includes(label)) {
    throw validationError('Speaker label is in use and cannot be deleted.');
  }

  const masterLabels = session.speakerLabels ?? [];
  if (!masterLabels.includes(label)) {
    throw notFoundError('指定された話者ラベルが見つかりません。');
  }

  const remaining = masterLabels.filter((l) => l !== label);
  return updateSessionSpeakerLabels(sessionId, remaining);
}

/**
 * Auto-create a ReviewSession when a new TranscriptionJob is registered.
 * Creates the session with PENDING status (Requirement 5.6).
 *
 * @param transcriptionJobId - The ID of the TranscriptionJob
 * @param name - The name for the ReviewSession (typically the job name)
 * @param teamId - Optional team ID for team-based access
 * @param assignedUserId - Optional userId to auto-assign the session to (the uploader)
 */
export async function createSessionForJob(
  transcriptionJobId: string,
  name: string,
  teamId?: string,
  assignedUserId?: string
): Promise<SessionRecord> {
  const sessionId = uuidv4();

  const input: CreateSessionInput = {
    sessionId,
    transcriptionJobId,
    name,
    teamId,
    assignedUserId,
  };

  return createSession(input);
}

/**
 * List the sessions a reviewer participates in.
 * Used by GET /sessions/assigned so a reviewer can see their own workload.
 * A reviewer may participate in many sessions, and a session may have many
 * reviewers, so this reflects every session the user has joined.
 */
export async function getAssignedSessions(
  userId: string
): Promise<SessionRecord[]> {
  const sessions = await getSessionsByParticipantUserId(userId);
  return [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export interface AssignSessionInput {
  /** Assign the session directly to a reviewer (userId). */
  assignedUserId?: string;
  /** Assign the session to a team so its reviewers can claim it. */
  assignedTeamId?: string;
}

/**
 * (Re)assign a session to a user and/or a team.
 * Only ADMIN and TEAM_LEADER may assign. A TEAM_LEADER may only assign within
 * their own team: the target team (assignedTeamId) and/or the target user's
 * team must be one of the leader's teams. ADMIN may assign to anyone.
 *
 * @throws forbiddenError when the caller lacks permission or scope
 * @throws notFoundError when the session does not exist
 * @throws validationError when neither target is provided
 */
export async function assignSession(
  user: AuthUser,
  sessionId: string,
  input: AssignSessionInput
): Promise<SessionRecord> {
  requireRole(user, 'TEAM_LEADER');

  if (!input.assignedUserId && !input.assignedTeamId) {
    throw validationError(
      'assignedUserId または assignedTeamId のいずれかを指定してください。'
    );
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定されたセッションが見つかりません。');
  }

  // TEAM_LEADER is limited to their own team's scope; ADMIN has no scope limit.
  if (!isAdmin(user)) {
    const leaderTeamIds = new Set(await getUserTeamIds(user.userId));
    if (leaderTeamIds.size === 0) {
      throw forbiddenError('所属チームがないため割り当てできません。');
    }

    if (input.assignedTeamId && !leaderTeamIds.has(input.assignedTeamId)) {
      throw forbiddenError('自分のチームにのみ割り当てできます。');
    }

    if (input.assignedUserId) {
      const targetInLeaderTeam = await isUserInAnyTeam(
        input.assignedUserId,
        leaderTeamIds
      );
      if (!targetInLeaderTeam) {
        throw forbiddenError(
          '自分のチームのメンバーにのみ割り当てできます。'
        );
      }
    }

    // The session itself must belong to the leader's team scope.
    if (session.assignedTeamId && !leaderTeamIds.has(session.assignedTeamId)) {
      throw forbiddenError('このセッションを割り当てる権限がありません。');
    }
  }

  return updateSessionAssignment(sessionId, {
    assignedUserId: input.assignedUserId,
    assignedTeamId: input.assignedTeamId,
  });
}

/**
 * Join a session as a reviewer.
 *
 * Sessions are shared: multiple reviewers can join the same session so their
 * corrections can be aggregated by consensus. Joining is NOT exclusive and is
 * idempotent — a reviewer who already joined simply gets the session back
 * without changing the participant count.
 *
 * A reviewer may only join a session assigned to one of their teams. ADMIN may
 * join any session.
 *
 * @throws notFoundError when the session does not exist
 * @throws forbiddenError when the session is not in one of the user's teams
 */
export async function joinSession(
  user: AuthUser,
  sessionId: string
): Promise<SessionRecord> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定されたセッションが見つかりません。');
  }

  // ADMIN may join anything; others must be a member of the session's team.
  if (!isAdmin(user)) {
    if (!session.assignedTeamId) {
      throw forbiddenError('このセッションはチームに割り当てられていません。');
    }
    const member = await isTeamMember(user.userId, session.assignedTeamId);
    if (!member) {
      throw forbiddenError('自チームに割り当てられたセッションのみ参加できます。');
    }
  }

  // Register the reviewer as a participant. Idempotent: re-joining is a no-op
  // and does not double-count the reviewer.
  const added = await addParticipant(sessionId, user.userId);

  // Return the up-to-date session record (reviewer count may have changed).
  if (added) {
    const refreshed = await getSessionById(sessionId);
    return refreshed ?? session;
  }
  return session;
}

/**
 * List the sessions a user can self-assign (join) to.
 *
 * Candidates are PENDING sessions assigned (via assignedTeamId) to one of the
 * caller's DB teams that the caller has not yet joined. The scope is derived
 * strictly from DynamoDB team membership (getUserTeamIds) — never from JWT
 * claims — so this cannot be used to escalate privileges.
 *
 * - Non-ADMIN: the union of their teams' sessions (getSessionsByTeamId).
 * - ADMIN: all sessions (getAllSessions), matching the existing list APIs.
 *
 * The already-joined filter uses a single getSessionIdsByParticipantUserId
 * query turned into a Set, so no per-candidate participant lookups are issued.
 *
 * @returns PENDING, not-yet-joined candidate sessions, sorted by createdAt desc.
 */
export async function listJoinableSessions(
  user: AuthUser
): Promise<SessionRecord[]> {
  // 1. Gather the candidate population.
  const candidates = new Map<string, SessionRecord>();
  if (isAdmin(user)) {
    for (const session of await getAllSessions()) {
      candidates.set(session.sessionId, session);
    }
  } else {
    const teamIds = await getUserTeamIds(user.userId);
    for (const teamId of teamIds) {
      const teamSessions = await getSessionsByTeamId(teamId);
      for (const session of teamSessions) {
        // De-dup across teams (defensive against future multi-team indexing).
        candidates.set(session.sessionId, session);
      }
    }
  }

  // 2. Keep only PENDING sessions.
  const pending = [...candidates.values()].filter(
    (session) => session.status === 'PENDING'
  );

  // 3. Drop sessions the caller already participates in (single query + Set diff).
  const joinedIds = new Set(await getSessionIdsByParticipantUserId(user.userId));
  const notJoined = pending.filter(
    (session) => !joinedIds.has(session.sessionId)
  );

  // 4. Sort by createdAt descending (consistent with the other list APIs).
  return sortByCreatedAtDesc(notJoined);
}

/**
 * Self-assign (join) a session as the authenticated reviewer.
 *
 * Same authorization logic as joinSession, exposed as a distinct function so
 * the "reviewer self-assigns without waiting for a TEAM_LEADER/ADMIN" use case
 * is explicit and can be audited with reason: 'self-assign'.
 *
 * - ADMIN may join any session unconditionally.
 * - Others may only join a session whose assignedTeamId is one of their DB
 *   teams (verified by isTeamMember, DynamoDB-backed — NFR-1). requireRole is
 *   deliberately NOT used so REVIEWER is allowed through.
 * - Idempotent: re-joining is a no-op and does not double-count the reviewer.
 *
 * @throws notFoundError when the session does not exist
 * @throws forbiddenError when the session is not in one of the user's teams
 */
export async function selfAssignSession(
  user: AuthUser,
  sessionId: string
): Promise<SessionRecord> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定されたセッションが見つかりません。');
  }

  // ADMIN may join anything; others must be a member of the session's team.
  if (!isAdmin(user)) {
    if (!session.assignedTeamId) {
      throw forbiddenError('このセッションはチームに割り当てられていません。');
    }
    const member = await isTeamMember(user.userId, session.assignedTeamId);
    if (!member) {
      throw forbiddenError('自チームに割り当てられたセッションのみ参加できます。');
    }
  }

  // Register the reviewer as a participant. Idempotent: re-joining is a no-op
  // and does not double-count the reviewer.
  const added = await addParticipant(sessionId, user.userId);
  if (added) {
    const refreshed = await getSessionById(sessionId);
    return refreshed ?? session;
  }
  return session;
}

/**
 * Reopen a COMPLETED session back to IN_PROGRESS (進行中に戻す).
 *
 * Only ADMIN and TEAM_LEADER may reopen. A TEAM_LEADER may only reopen a
 * session in their own team; ADMIN may reopen any session. Only COMPLETED
 * sessions can be reopened — a non-COMPLETED session is rejected with 400.
 *
 * Policy A: confirmed ConsensusResult records and Segment consensusStatus are
 * preserved. This routes directly through updateSessionStatus (which touches
 * only the session METADATA status/updatedAt), NOT changeSessionStatus — the
 * COMPLETED → IN_PROGRESS transition is intentionally disallowed by
 * VALID_STATUS_TRANSITIONS.
 *
 * @throws forbiddenError when the caller lacks permission or scope
 * @throws notFoundError when the session does not exist
 * @throws validationError when the session is not COMPLETED
 */
export async function reopenSession(
  user: AuthUser,
  sessionId: string
): Promise<SessionRecord> {
  requireRole(user, 'TEAM_LEADER');

  const session = await getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定されたセッションが見つかりません。');
  }

  // TEAM_LEADER is limited to their own team's sessions; ADMIN has no limit.
  if (!isAdmin(user)) {
    if (!session.assignedTeamId) {
      throw forbiddenError('このセッションを操作する権限がありません。');
    }
    const member = await isTeamMember(user.userId, session.assignedTeamId);
    if (!member) {
      throw forbiddenError('自チームのセッションのみ操作できます。');
    }
  }

  if (session.status !== 'COMPLETED') {
    throw validationError('完了していないセッションは差し戻しできません。');
  }

  // Policy A: only the session status is updated; consensus/segment data stays.
  return updateSessionStatus(sessionId, 'IN_PROGRESS');
}

/**
 * Internal helper: is the user a member of any team in the given set?
 */
async function isUserInAnyTeam(
  userId: string,
  teamIds: Set<string>
): Promise<boolean> {
  const userTeamIds = await getUserTeamIds(userId);
  return userTeamIds.some((teamId) => teamIds.has(teamId));
}
