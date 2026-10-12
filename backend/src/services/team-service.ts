/**
 * Team Service
 *
 * Business logic for team management operations.
 * Enforces:
 * - TeamLeader scope check (can only manage own teams) (Req 13.9)
 * - Cascade delete of TeamAssignments when team is deleted (Req 13.10)
 * - Revoke ReviewAssignment access when user loses all team memberships (Req 13.8)
 */

import { v4 as uuidv4 } from 'uuid';
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
  type TeamRecord,
  type TeamMembershipRecord,
  type TeamAssignmentRecord,
  type ReviewAssignmentRecord,
} from '../repositories/team-repository.js';
import {
  requireTeamAccess,
  getUserTeamIds,
  isTeamMember,
} from './access-control-service.js';
import { getUserById } from '../repositories/user-repository.js';
import { type AuthUser, isAdmin } from '../utils/auth-middleware.js';
import {
  validationError,
  notFoundError,
  forbiddenError,
} from '../utils/error-handler.js';

// ============================================================
// Team CRUD
// ============================================================

/**
 * List teams accessible to the user.
 * - ADMIN: all teams
 * - TEAM_LEADER: only their own teams
 * - REVIEWER: forbidden
 */
export async function listTeams(user: AuthUser): Promise<TeamRecord[]> {
  if (!isAdmin(user) && user.role !== 'TEAM_LEADER') {
    throw forbiddenError('この操作を実行する権限がありません。');
  }

  return isAdmin(user)
    ? await getAllTeams()
    : await getTeamsByUserId(user.userId);
}

/**
 * Create a new team.
 * - ADMIN: can create any team
 * - TEAM_LEADER: can create a team (they become a member)
 */
export async function createNewTeam(
  user: AuthUser,
  input: { name: string; members?: string[] }
): Promise<TeamRecord> {
  if (!isAdmin(user) && user.role !== 'TEAM_LEADER') {
    throw forbiddenError('この操作を実行する権限がありません。');
  }

  if (!input.name || input.name.trim() === '') {
    throw validationError('チーム名は必須です。');
  }

  const teamId = uuidv4();
  const team = await createTeam({
    teamId,
    name: input.name.trim(),
    createdBy: user.userId,
  });

  // If TEAM_LEADER creates a team, add them as a member
  if (user.role === 'TEAM_LEADER') {
    await addTeamMember(teamId, user.userId);
  }

  // Add initial members if provided
  if (Array.isArray(input.members)) {
    for (const memberId of input.members) {
      if (typeof memberId === 'string' && memberId !== user.userId) {
        await addTeamMember(teamId, memberId);
      }
    }
  }

  return team;
}

/**
 * Update a team.
 * - ADMIN: can update any team
 * - TEAM_LEADER: can only update their own team (Req 13.9)
 */
export async function updateExistingTeam(
  user: AuthUser,
  teamId: string,
  input: { name: string }
): Promise<TeamRecord> {
  const existingTeam = await getTeamById(teamId);
  if (!existingTeam) {
    throw notFoundError('チームが見つかりません。');
  }

  // TEAM_LEADER can only manage their own team (Req 13.9)
  await requireTeamAccess(user, teamId);

  if (!input.name || input.name.trim() === '') {
    throw validationError('チーム名は必須です。');
  }

  return await updateTeam(teamId, { name: input.name.trim() });
}

/**
 * Delete a team with cascade operations.
 * - ADMIN only (Req 13.10)
 *
 * Cascade:
 * 1. Delete all TeamAssignments for this team
 * 2. Delete all TeamMemberships
 * 3. Delete the team itself
 * 4. Revoke ReviewAssignments for members who lost all team memberships
 */
export async function deleteExistingTeam(
  user: AuthUser,
  teamId: string
): Promise<void> {
  if (!isAdmin(user)) {
    throw forbiddenError('チームの削除はAdmin権限が必要です。');
  }

  const existingTeam = await getTeamById(teamId);
  if (!existingTeam) {
    throw notFoundError('チームが見つかりません。');
  }

  // Get members before deletion (needed for membership loss check)
  const members = await getTeamMembers(teamId);

  // Cascade: delete all TeamAssignments for this team (Req 13.10)
  await deleteAllTeamAssignments(teamId);

  // Cascade: delete all TeamMemberships
  await deleteAllTeamMembers(teamId);

  // Delete the team itself
  await deleteTeam(teamId);

  // Revoke ReviewAssignments for members who lost all team memberships (Req 13.8)
  await revokeOrphanedReviewAssignments(members);
}

// ============================================================
// Team Members
// ============================================================

/**
 * A team member enriched with the user's display name and email so the UI can
 * render a friendly dropdown without the ADMIN-only GET /admin/users endpoint.
 */
export interface TeamMemberWithProfile extends TeamMembershipRecord {
  displayName?: string;
  email?: string;
}

/**
 * List members of a team, enriched with each user's display name and email.
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 */
export async function listTeamMembers(
  user: AuthUser,
  teamId: string
): Promise<TeamMemberWithProfile[]> {
  await requireTeamAccess(user, teamId);

  const members = await getTeamMembers(teamId);

  // Resolve profiles in parallel; fall back to the bare membership if a user
  // record is missing so a stale membership never breaks the listing.
  return Promise.all(
    members.map(async (member) => {
      const profile = await getUserById(member.userId);
      return {
        ...member,
        displayName: profile?.displayName,
        email: profile?.email,
      };
    })
  );
}

/**
 * Add a member to a team.
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 *
 * Adding a member grants them access to all sessions assigned to this team (Req 13.2).
 */
export async function addMemberToTeam(
  user: AuthUser,
  teamId: string,
  userId: string
): Promise<TeamMembershipRecord> {
  if (!userId || typeof userId !== 'string') {
    throw validationError('ユーザーIDは必須です。');
  }

  await requireTeamAccess(user, teamId);

  return await addTeamMember(teamId, userId);
}

/**
 * Remove a member from a team.
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 *
 * When a user loses all team memberships, their ReviewAssignments are revoked (Req 13.8).
 */
export async function removeMemberFromTeam(
  user: AuthUser,
  teamId: string,
  userId: string
): Promise<void> {
  if (!userId || typeof userId !== 'string') {
    throw validationError('ユーザーIDは必須です。');
  }

  await requireTeamAccess(user, teamId);

  await removeTeamMember(teamId, userId);

  // Check if user lost all team memberships and revoke ReviewAssignments if so (Req 13.8)
  await revokeReviewAssignmentsIfOrphaned(userId);
}

// ============================================================
// TeamAssignment
// ============================================================

/**
 * List TeamAssignments for a team.
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 */
export async function listAssignments(
  user: AuthUser,
  teamId: string
): Promise<TeamAssignmentRecord[]> {
  await requireTeamAccess(user, teamId);
  return await getTeamAssignments(teamId);
}

/**
 * Create a TeamAssignment (assign a session to a team).
 * All team members gain access to the session (Req 13.4).
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 */
export async function createAssignment(
  user: AuthUser,
  teamId: string,
  sessionId: string
): Promise<TeamAssignmentRecord> {
  if (!sessionId || typeof sessionId !== 'string') {
    throw validationError('セッションIDは必須です。');
  }

  await requireTeamAccess(user, teamId);

  return await createTeamAssignment({
    teamId,
    sessionId,
    createdBy: user.userId,
  });
}

/**
 * Delete a TeamAssignment.
 * Members without other assignments lose access on next access attempt (Req 13.5).
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team (Req 13.9)
 */
export async function deleteAssignment(
  user: AuthUser,
  teamId: string,
  sessionId: string
): Promise<void> {
  if (!sessionId || typeof sessionId !== 'string') {
    throw validationError('セッションIDは必須です。');
  }

  await requireTeamAccess(user, teamId);

  await deleteTeamAssignment(teamId, sessionId);
}

// ============================================================
// ReviewAssignment
// ============================================================

/**
 * Create a ReviewAssignment (assign a session directly to a user).
 * The user must be a member of the team (Req 13.8).
 * - ADMIN: any team
 * - TEAM_LEADER: only their own team members (Req 13.9)
 */
export async function createUserReviewAssignment(
  user: AuthUser,
  teamId: string,
  targetUserId: string,
  sessionId: string
): Promise<ReviewAssignmentRecord> {
  if (!targetUserId || typeof targetUserId !== 'string') {
    throw validationError('ユーザーIDは必須です。');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw validationError('セッションIDは必須です。');
  }

  // TEAM_LEADER can only manage their own team (Req 13.9)
  await requireTeamAccess(user, teamId);

  // Verify the target user is a member of the team (Req 13.8)
  const memberOfTeam = await isTeamMember(targetUserId, teamId);
  if (!memberOfTeam) {
    throw forbiddenError(
      '対象ユーザーはこのチームのメンバーではありません。'
    );
  }

  return await createReviewAssignment({
    userId: targetUserId,
    sessionId,
    createdBy: user.userId,
  });
}

// ============================================================
// Membership Loss Revocation (Req 13.8)
// ============================================================

/**
 * Check if a user has lost all team memberships and revoke their ReviewAssignments.
 *
 * Per Req 13.8:
 * "WHEN Userがすべての Team メンバーシップを失った（いずれの Team にも所属しなくなった）とき、
 *  THE App SHALL そのUserの個別ReviewAssignmentによるアクセスを取り消す。"
 */
async function revokeReviewAssignmentsIfOrphaned(userId: string): Promise<void> {
  const teamIds = await getUserTeamIds(userId);

  // If user still belongs to at least one team, no revocation needed
  if (teamIds.length > 0) {
    return;
  }

  // User has no team memberships - revoke all ReviewAssignments
  const reviewAssignments = await getReviewAssignmentsByUser(userId);
  for (const assignment of reviewAssignments) {
    await deleteReviewAssignment(userId, assignment.sessionId);
  }
}

/**
 * Check multiple members for membership loss and revoke ReviewAssignments.
 * Used during team deletion cascade.
 */
async function revokeOrphanedReviewAssignments(
  members: TeamMembershipRecord[]
): Promise<void> {
  for (const member of members) {
    await revokeReviewAssignmentsIfOrphaned(member.userId);
  }
}
