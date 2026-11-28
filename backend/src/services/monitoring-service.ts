import {
  isAdmin,
  requireRole,
  denyResourceAccess,
  type AuthUser,
} from '../utils/auth-middleware.js';
import { getStalledThresholdDays, isStalled } from '../utils/stalled-threshold.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import {
  getAllSessions,
  getSessionsByTeamId,
  getSessionById,
  getParticipants,
  getSessionsByParticipantUserId,
  getSessionIdsByParticipantUserId,
  sortByCreatedAtDesc,
  SESSION_PAGE_SIZE,
  type SessionRecord,
} from '../repositories/session-repository.js';
import {
  getLastCorrectionAt,
  getCorrections,
  type CorrectionRecord,
} from '../repositories/correction-repository.js';
import { getSessionSegments } from '../repositories/segment-repository.js';
import {
  getTeamsByUserId,
  getTeamMembers,
  getTeamById,
} from '../repositories/team-repository.js';
import { getAllUsers, getUserById } from '../repositories/user-repository.js';
import type { PaginatedResponse } from '../types/index.js';

/**
 * MonitoringService powers the ADMIN / TEAM_LEADER overview of session
 * assignment, status and per-reviewer progress.
 *
 * Scope rules (derived from DynamoDB team membership, never from the JWT):
 * - ADMIN: every session and user.
 * - TEAM_LEADER: sessions whose assignedTeamId is one of the leader's teams,
 *   and the members of those teams. Anything outside is hidden with a 404.
 *
 * Progress definition: unique segments with at least one TEXT correction by
 * the reviewer / total segments of the session. Confirming a segment without
 * changing the text still stores a TEXT correction, so this reflects "reviewed".
 *
 * Stalled definition: IN_PROGRESS and the newest correction among the session's
 * participants (or the session's createdAt when there is none) is at least
 * STALLED_THRESHOLD_DAYS days old.
 */

export interface MonitoringScope {
  /** True for ADMIN: no team restriction. */
  all: boolean;
  /** Team IDs the TEAM_LEADER belongs to (empty for ADMIN). */
  teamIds: ReadonlySet<string>;
}

export interface SessionMonitoringFilters {
  status?: SessionRecord['status'];
  teamId?: string;
  userId?: string;
  unassignedOnly?: boolean;
  stalledOnly?: boolean;
}

export interface MonitoringSessionItem {
  sessionId: string;
  name: string;
  status: SessionRecord['status'];
  assignedUserId?: string;
  assignedUserName?: string;
  assignedTeamId?: string;
  assignedTeamName?: string;
  participantCount: number;
  isUnassigned: boolean;
  isStalled: boolean;
  /** Newest correction time (or createdAt). null when not computed (non IN_PROGRESS). */
  lastActivityAt: string | null;
  createdAt: string;
}

export interface ReviewerProgress {
  userId: string;
  displayName: string;
  correctedSegments: number;
  totalSegments: number;
  progressPercent: number;
  lastActivityAt: string | null;
}

export interface SessionProgress {
  sessionId: string;
  name: string;
  status: SessionRecord['status'];
  totalSegments: number;
  isStalled: boolean;
  lastActivityAt: string | null;
  reviewers: ReviewerProgress[];
}

export interface UserWorkloadItem {
  userId: string;
  displayName: string;
  email: string;
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  isActive: boolean;
  assignedCount: number;
  inProgressCount: number;
  stalledCount: number;
}

export interface UserSessionItem {
  sessionId: string;
  name: string;
  status: SessionRecord['status'];
  assignedTeamId?: string;
  assignedTeamName?: string;
  isStalled: boolean;
  lastActivityAt: string | null;
  correctedSegments: number;
  totalSegments: number;
  progressPercent: number;
}

/** Per-request memo of session -> last activity, shared by every code path. */
type ActivityCache = Map<string, Promise<string>>;

/** Percentage (0-100, integer) of corrected segments; 0 when there are none. */
export function calcProgressPercent(corrected: number, total: number): number {
  if (total <= 0 || corrected <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((corrected / total) * 100));
}

/**
 * Count unique segments with a TEXT correction. Only segments that exist in
 * the session are counted, so the result never exceeds `segmentIds.size`.
 */
export function countCorrectedSegments(
  corrections: readonly Pick<CorrectionRecord, 'segmentId' | 'correctionType'>[],
  segmentIds: ReadonlySet<string>
): number {
  const corrected = new Set<string>();
  for (const correction of corrections) {
    if (correction.correctionType === 'TEXT' && segmentIds.has(correction.segmentId)) {
      corrected.add(correction.segmentId);
    }
  }
  return corrected.size;
}

/** Newest ISO timestamp, or null for an empty list. */
function latestOf(timestamps: readonly string[]): string | null {
  let latest: string | null = null;
  for (const ts of timestamps) {
    if (latest === null || ts > latest) {
      latest = ts;
    }
  }
  return latest;
}

/**
 * Resolve the caller's monitoring scope. Requires TEAM_LEADER or above (403
 * for REVIEWER). The leader's teams come from DynamoDB membership.
 */
export async function resolveScope(user: AuthUser): Promise<MonitoringScope> {
  requireRole(user, 'TEAM_LEADER');
  if (isAdmin(user)) {
    return { all: true, teamIds: new Set() };
  }
  const teams = await getTeamsByUserId(user.userId);
  return { all: false, teamIds: new Set(teams.map((team) => team.teamId)) };
}

/** Whether a session is visible within the scope. */
export function isSessionInScope(
  scope: MonitoringScope,
  session: Pick<SessionRecord, 'assignedTeamId'>
): boolean {
  if (scope.all) {
    return true;
  }
  return session.assignedTeamId !== undefined && scope.teamIds.has(session.assignedTeamId);
}

/** User IDs visible within the scope (undefined means every user). */
async function resolveVisibleUserIds(
  scope: MonitoringScope
): Promise<Set<string> | undefined> {
  if (scope.all) {
    return undefined;
  }
  const memberLists = await mapWithConcurrency([...scope.teamIds], (teamId) =>
    getTeamMembers(teamId)
  );
  return new Set(memberLists.flat().map((member) => member.userId));
}

/**
 * Newest activity of a session: the latest correction by any participant, or
 * the session's createdAt when no one has corrected anything yet. Memoized per
 * request through `cache`.
 */
export function getSessionLastActivityAt(
  session: Pick<SessionRecord, 'sessionId' | 'createdAt'>,
  cache: ActivityCache
): Promise<string> {
  const cached = cache.get(session.sessionId);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const participants = await getParticipants(session.sessionId);
    const times = await mapWithConcurrency(participants, (participant) =>
      getLastCorrectionAt(session.sessionId, participant.userId)
    );
    return latestOf(times.filter((t): t is string => t !== null)) ?? session.createdAt;
  })();

  cache.set(session.sessionId, pending);
  return pending;
}

/** Stalled flag + lastActivityAt for a session (only IN_PROGRESS can be stalled). */
async function evaluateStalled(
  session: SessionRecord,
  cache: ActivityCache,
  now: Date,
  thresholdDays: number
): Promise<{ isStalled: boolean; lastActivityAt: string | null }> {
  if (session.status !== 'IN_PROGRESS') {
    return { isStalled: false, lastActivityAt: null };
  }
  const lastActivityAt = await getSessionLastActivityAt(session, cache);
  return { isStalled: isStalled(lastActivityAt, now, thresholdDays), lastActivityAt };
}

/**
 * Cheap filters that need no extra reads. `participantSessionIds` is the set of
 * sessions the filtered reviewer participates in (required for `userId`).
 * The result is always a subset of the input, in the same order.
 */
export function applyBasicFilters(
  sessions: readonly SessionRecord[],
  filters: SessionMonitoringFilters,
  participantSessionIds?: ReadonlySet<string>
): SessionRecord[] {
  return sessions.filter((session) => {
    if (filters.status && session.status !== filters.status) {
      return false;
    }
    if (filters.teamId && session.assignedTeamId !== filters.teamId) {
      return false;
    }
    if (filters.userId) {
      const isAssignee = session.assignedUserId === filters.userId;
      const isParticipant = participantSessionIds?.has(session.sessionId) ?? false;
      if (!isAssignee && !isParticipant) {
        return false;
      }
    }
    if (filters.unassignedOnly && !isUnassignedSession(session)) {
      return false;
    }
    return true;
  });
}

/** A session with no assignee and no participants. */
export function isUnassignedSession(
  session: Pick<SessionRecord, 'assignedUserId' | 'assignedReviewerCount'>
): boolean {
  return !session.assignedUserId && (session.assignedReviewerCount ?? 0) === 0;
}

function paginate<T>(items: readonly T[], page: number): PaginatedResponse<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / SESSION_PAGE_SIZE));
  const start = (page - 1) * SESSION_PAGE_SIZE;
  return {
    items: items.slice(start, start + SESSION_PAGE_SIZE),
    pagination: {
      currentPage: page,
      pageSize: SESSION_PAGE_SIZE,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

/** Sessions visible to the caller. Never falls back to a table scan for leaders. */
async function loadScopedSessions(scope: MonitoringScope): Promise<SessionRecord[]> {
  if (scope.all) {
    // Same source the existing GET /sessions uses for ADMIN.
    return getAllSessions();
  }
  const lists = await mapWithConcurrency([...scope.teamIds], (teamId) =>
    getSessionsByTeamId(teamId)
  );
  const byId = new Map<string, SessionRecord>();
  for (const session of lists.flat()) {
    byId.set(session.sessionId, session);
  }
  return [...byId.values()];
}

/** Small per-request lookup cache for display names. */
function createNameResolvers() {
  const users = new Map<string, Promise<string | undefined>>();
  const teams = new Map<string, Promise<string | undefined>>();
  return {
    userName(userId: string): Promise<string | undefined> {
      let pending = users.get(userId);
      if (!pending) {
        pending = getUserById(userId).then((u) => u?.displayName);
        users.set(userId, pending);
      }
      return pending;
    },
    teamName(teamId: string): Promise<string | undefined> {
      let pending = teams.get(teamId);
      if (!pending) {
        pending = getTeamById(teamId).then((t) => t?.name);
        teams.set(teamId, pending);
      }
      return pending;
    },
  };
}

/**
 * List sessions with assignment, status and badge flags for the monitoring view.
 * Percent progress is intentionally NOT computed here (see getSessionProgress).
 */
export async function listSessionMonitoring(
  user: AuthUser,
  filters: SessionMonitoringFilters,
  page: number,
  now: Date = new Date()
): Promise<PaginatedResponse<MonitoringSessionItem>> {
  const scope = await resolveScope(user);
  const thresholdDays = getStalledThresholdDays();
  const cache: ActivityCache = new Map();

  let sessions = await loadScopedSessions(scope);

  const participantSessionIds = filters.userId
    ? new Set(await getSessionIdsByParticipantUserId(filters.userId))
    : undefined;
  sessions = sortByCreatedAtDesc(applyBasicFilters(sessions, filters, participantSessionIds));

  // stalledOnly needs the activity time of every IN_PROGRESS candidate.
  const evaluations = new Map<string, { isStalled: boolean; lastActivityAt: string | null }>();
  if (filters.stalledOnly) {
    const candidates = sessions.filter((s) => s.status === 'IN_PROGRESS');
    const results = await mapWithConcurrency(candidates, (s) =>
      evaluateStalled(s, cache, now, thresholdDays)
    );
    candidates.forEach((s, i) => evaluations.set(s.sessionId, results[i]!));
    sessions = sessions.filter((s) => evaluations.get(s.sessionId)?.isStalled === true);
  }

  const paged = paginate(sessions, page);
  const names = createNameResolvers();

  const items = await mapWithConcurrency(paged.items, async (session) => {
    const evaluation =
      evaluations.get(session.sessionId) ??
      (await evaluateStalled(session, cache, now, thresholdDays));
    const [assignedUserName, assignedTeamName] = await Promise.all([
      session.assignedUserId ? names.userName(session.assignedUserId) : undefined,
      session.assignedTeamId ? names.teamName(session.assignedTeamId) : undefined,
    ]);

    const item: MonitoringSessionItem = {
      sessionId: session.sessionId,
      name: session.name,
      status: session.status,
      participantCount: session.assignedReviewerCount ?? 0,
      isUnassigned: isUnassignedSession(session),
      isStalled: evaluation.isStalled,
      lastActivityAt: evaluation.lastActivityAt,
      createdAt: session.createdAt,
      ...(session.assignedUserId ? { assignedUserId: session.assignedUserId } : {}),
      ...(assignedUserName ? { assignedUserName } : {}),
      ...(session.assignedTeamId ? { assignedTeamId: session.assignedTeamId } : {}),
      ...(assignedTeamName ? { assignedTeamName } : {}),
    };
    return item;
  });

  return { items, pagination: paged.pagination };
}

/**
 * Per-reviewer progress for one session. A session outside the caller's scope
 * (or a missing one) yields 404 to hide its existence.
 */
export async function getSessionProgress(
  user: AuthUser,
  sessionId: string,
  now: Date = new Date()
): Promise<SessionProgress> {
  const scope = await resolveScope(user);
  const session = await getSessionById(sessionId);
  if (!session || !isSessionInScope(scope, session)) {
    denyResourceAccess();
  }

  const [segments, participants] = await Promise.all([
    getSessionSegments(sessionId),
    getParticipants(sessionId),
  ]);
  const segmentIds = new Set(segments.map((s) => s.segmentId));
  const names = createNameResolvers();

  const reviewers = await mapWithConcurrency(participants, async (participant) => {
    const [corrections, displayName] = await Promise.all([
      getCorrections(sessionId, participant.userId),
      names.userName(participant.userId),
    ]);
    const correctedSegments = countCorrectedSegments(corrections, segmentIds);
    const reviewer: ReviewerProgress = {
      userId: participant.userId,
      displayName: displayName ?? participant.userId,
      correctedSegments,
      totalSegments: segmentIds.size,
      progressPercent: calcProgressPercent(correctedSegments, segmentIds.size),
      lastActivityAt: latestOf(corrections.map((c) => c.createdAt)),
    };
    return reviewer;
  });

  const lastActivityAt =
    latestOf(reviewers.map((r) => r.lastActivityAt).filter((t): t is string => t !== null)) ??
    session.createdAt;

  return {
    sessionId,
    name: session.name,
    status: session.status,
    totalSegments: segmentIds.size,
    isStalled:
      session.status === 'IN_PROGRESS' &&
      isStalled(lastActivityAt, now, getStalledThresholdDays()),
    lastActivityAt: session.status === 'IN_PROGRESS' ? lastActivityAt : null,
    reviewers,
  };
}

/**
 * Per-user workload counts (assigned / in progress / stalled). Counts only; no
 * percent progress (see listUserSessions).
 */
export async function listUserWorkload(
  user: AuthUser,
  now: Date = new Date()
): Promise<UserWorkloadItem[]> {
  const scope = await resolveScope(user);
  const thresholdDays = getStalledThresholdDays();
  const cache: ActivityCache = new Map();

  const visibleUserIds = await resolveVisibleUserIds(scope);
  let targets;
  if (visibleUserIds === undefined) {
    targets = await getAllUsers();
  } else {
    const records = await mapWithConcurrency([...visibleUserIds], (id) => getUserById(id));
    targets = records.filter((r): r is NonNullable<typeof r> => r !== null);
  }

  const items = await mapWithConcurrency(targets, async (target) => {
    const sessions = (await getSessionsByParticipantUserId(target.userId)).filter((s) =>
      isSessionInScope(scope, s)
    );
    const inProgress = sessions.filter((s) => s.status === 'IN_PROGRESS');
    const evaluations = await mapWithConcurrency(inProgress, (s) =>
      evaluateStalled(s, cache, now, thresholdDays)
    );
    const item: UserWorkloadItem = {
      userId: target.userId,
      displayName: target.displayName,
      email: target.email,
      role: target.role,
      isActive: target.isActive,
      assignedCount: sessions.length,
      inProgressCount: inProgress.length,
      stalledCount: evaluations.filter((e) => e.isStalled).length,
    };
    return item;
  });

  return items.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Sessions a user participates in, with that user's own progress per session.
 * A user outside the caller's scope (or missing) yields 404.
 */
export async function listUserSessions(
  user: AuthUser,
  targetUserId: string,
  now: Date = new Date()
): Promise<UserSessionItem[]> {
  const scope = await resolveScope(user);

  const visibleUserIds = await resolveVisibleUserIds(scope);
  if (visibleUserIds !== undefined && !visibleUserIds.has(targetUserId)) {
    denyResourceAccess();
  }
  const target = await getUserById(targetUserId);
  if (!target) {
    denyResourceAccess();
  }

  const thresholdDays = getStalledThresholdDays();
  const cache: ActivityCache = new Map();
  const names = createNameResolvers();

  const sessions = sortByCreatedAtDesc(
    (await getSessionsByParticipantUserId(targetUserId)).filter((s) =>
      isSessionInScope(scope, s)
    )
  );

  return mapWithConcurrency(sessions, async (session) => {
    const [segments, corrections, evaluation, assignedTeamName] = await Promise.all([
      getSessionSegments(session.sessionId),
      getCorrections(session.sessionId, targetUserId),
      evaluateStalled(session, cache, now, thresholdDays),
      session.assignedTeamId ? names.teamName(session.assignedTeamId) : undefined,
    ]);
    const segmentIds = new Set(segments.map((s) => s.segmentId));
    const correctedSegments = countCorrectedSegments(corrections, segmentIds);

    const item: UserSessionItem = {
      sessionId: session.sessionId,
      name: session.name,
      status: session.status,
      isStalled: evaluation.isStalled,
      lastActivityAt: evaluation.lastActivityAt,
      correctedSegments,
      totalSegments: segmentIds.size,
      progressPercent: calcProgressPercent(correctedSegments, segmentIds.size),
      ...(session.assignedTeamId ? { assignedTeamId: session.assignedTeamId } : {}),
      ...(assignedTeamName ? { assignedTeamName } : {}),
    };
    return item;
  });
}
