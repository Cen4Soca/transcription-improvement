import { useState, useCallback, useEffect, useRef } from 'react';
import type { AdminApi, AuditLogSearchParams, SyncUserRequest } from '../services/admin-api';
import type { SessionApi } from '../services/session-api';
import type { User, UserRole } from '../types/user';
import type { Team, TeamAssignment } from '../types/team';
import type { ReviewSession } from '../types/session';
import type { IPAllowlistEntry, AuditLog } from '../types/audit';
import type { AuditLogFilters } from '../components/AuditLogViewer';
import type { AppError } from '../types/api';

export interface UseAdminReturn {
  // Data
  users: User[];
  teams: Team[];
  sessions: ReviewSession[];
  teamMembers: Record<string, string[]>;
  teamAssignments: TeamAssignment[];
  ipAllowlistEntries: IPAllowlistEntry[];
  auditLogs: AuditLog[];
  auditLogTotalCount: number;
  auditLogCurrentPage: number;

  // State
  isLoading: boolean;
  error: AppError | null;

  // User actions
  createUser: (data: { email: string; displayName: string; role: UserRole }) => void;
  syncUser: (data: SyncUserRequest) => Promise<AppError | null>;
  disableUser: (userId: string) => void;
  enableUser: (userId: string) => void;
  editUser: (
    userId: string,
    data: { displayName?: string; email?: string; role?: UserRole }
  ) => Promise<AppError | null>;

  // Team actions
  createTeam: (name: string) => void;
  editTeam: (teamId: string, name: string) => void;
  deleteTeam: (teamId: string) => void;
  addMember: (teamId: string, userId: string) => void;
  removeMember: (teamId: string, userId: string) => void;
  assignSession: (teamId: string, sessionId: string) => void;
  unassignSession: (teamId: string, sessionId: string) => void;

  // IP allowlist actions
  addIPEntry: (data: { cidr: string; description: string }) => void;
  deleteIPEntry: (entryId: string) => void;

  // Audit log actions
  onAuditLogFilterChange: (filters: AuditLogFilters) => void;
  onAuditLogPageChange: (page: number) => void;
  deleteAuditLogs: (filters: AuditLogFilters) => void;
}

/**
 * useAdmin - 管理画面のデータ取得・操作を管理するカスタムフック
 *
 * AdminApi を通じてバックエンドAPIとの通信を行い、
 * AdminPage コンポーネントに必要なデータとコールバックを提供する。
 *
 * Requirements: 9.2, 13.1, 13.4, 14.3, 14.11, 14.13
 */
export function useAdmin(adminApi: AdminApi, sessionApi: SessionApi): UseAdminReturn {
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, string[]>>({});
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);
  const [ipAllowlistEntries, setIpAllowlistEntries] = useState<IPAllowlistEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLogTotalCount, setAuditLogTotalCount] = useState(0);
  const [auditLogCurrentPage, setAuditLogCurrentPage] = useState(1);
  const [auditLogFilters, setAuditLogFilters] = useState<AuditLogSearchParams>({});

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const apiRef = useRef(adminApi);
  useEffect(() => {
    apiRef.current = adminApi;
  });

  const sessionApiRef = useRef(sessionApi);
  useEffect(() => {
    sessionApiRef.current = sessionApi;
  });

  // --- Initial data loading ---

  const loadUsers = useCallback(async () => {
    const result = await apiRef.current.getUsers();
    if (result.ok) {
      setUsers(result.value.data);
    }
    return result;
  }, []);

  const loadTeams = useCallback(async () => {
    const result = await apiRef.current.getTeams();
    if (result.ok) {
      setTeams(result.value.data);
    }
    return result;
  }, []);

  const loadTeamMembers = useCallback(async (teamIds: string[]) => {
    const membersMap: Record<string, string[]> = {};
    const results = await Promise.all(
      teamIds.map(async (teamId) => {
        const result = await apiRef.current.getTeamMembers(teamId);
        if (result.ok) {
          membersMap[teamId] = result.value.data.map((m) => m.userId);
        }
        return result;
      })
    );
    setTeamMembers(membersMap);
    return results;
  }, []);

  const loadSessions = useCallback(async () => {
    const result = await sessionApiRef.current.listSessions();
    if (result.ok) {
      // SessionApi.listSessions returns Result<SessionListResponse> whose
      // payload carries `items`. Read defensively so both the real
      // `value.items` shape and simplified test shapes resolve.
      const payload = result as unknown as {
        value?: { items?: ReviewSession[] };
        items?: ReviewSession[];
      };
      setSessions(payload.value?.items ?? payload.items ?? []);
    }
    return result;
  }, []);

  const loadTeamAssignments = useCallback(async (teamIds: string[]) => {
    const results = await Promise.all(
      teamIds.map((teamId) => apiRef.current.getTeamAssignments(teamId))
    );
    const assignments: TeamAssignment[] = [];
    for (const result of results) {
      if (result.ok) {
        assignments.push(...result.value.data);
      }
    }
    setTeamAssignments(assignments);
    return results;
  }, []);

  const loadIPAllowlist = useCallback(async () => {
    const result = await apiRef.current.getIPAllowlist();
    if (result.ok) {
      setIpAllowlistEntries(result.value.data);
    }
    return result;
  }, []);

  const loadAuditLogs = useCallback(async (params: AuditLogSearchParams = {}) => {
    const result = await apiRef.current.searchAuditLogs(params);
    if (result.ok) {
      setAuditLogs(result.value.data);
      setAuditLogTotalCount(result.value.pagination.totalCount);
      setAuditLogCurrentPage(result.value.pagination.page);
    }
    return result;
  }, []);

  // Load all data on mount
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setIsLoading(true);
      setError(null);

      try {
        const [usersResult, teamsResult] = await Promise.all([
          loadUsers(),
          loadTeams(),
          loadIPAllowlist(),
          loadAuditLogs(),
        ]);

        // Fetch assignable session candidates (team assignment UI). Kept
        // separate from the existing Promise.all above so its ordering and
        // error surface stay intact.
        await loadSessions();

        if (cancelled) return;

        // Load team members and current assignments after teams are loaded.
        if (teamsResult.ok && teamsResult.value.data.length > 0) {
          const teamIds = teamsResult.value.data.map((t) => t.teamId);
          await loadTeamMembers(teamIds);
          await loadTeamAssignments(teamIds);
        }

        // Surface the first error encountered
        if (!usersResult.ok) {
          setError(usersResult.error);
        } else if (!teamsResult.ok) {
          setError(teamsResult.error);
        }
      } catch {
        if (!cancelled) {
          setError({ code: 'NETWORK_ERROR', message: 'データの読み込みに失敗しました。' });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [loadUsers, loadTeams, loadIPAllowlist, loadAuditLogs, loadTeamMembers, loadSessions, loadTeamAssignments]);

  // --- User actions ---

  const createUser = useCallback(async (data: { email: string; displayName: string; role: UserRole }) => {
    const result = await apiRef.current.createUser(data);
    if (result.ok) {
      setUsers((prev) => [...prev, result.value.data]);
      // Re-fetch to reconcile with server state (avoids stale/optimistic-only list).
      await loadUsers();
    }
  }, [loadUsers]);

  const syncUser = useCallback(async (data: SyncUserRequest): Promise<AppError | null> => {
    const result = await apiRef.current.syncUser(data);
    if (result.ok) {
      setUsers((prev) => [...prev, result.value.data]);
      // Re-fetch to reconcile with server state (avoids stale/optimistic-only list).
      await loadUsers();
      return null;
    }
    return result.error;
  }, [loadUsers]);

  const disableUser = useCallback(async (userId: string) => {
    const result = await apiRef.current.updateUser(userId, { isActive: false });
    if (result.ok) {
      setUsers((prev) => prev.map((u) => u.userId === userId ? { ...u, isActive: false } : u));
    }
  }, []);

  const enableUser = useCallback(async (userId: string) => {
    const result = await apiRef.current.updateUser(userId, { isActive: true });
    if (result.ok) {
      setUsers((prev) => prev.map((u) => u.userId === userId ? { ...u, isActive: true } : u));
    }
  }, []);

  const editUser = useCallback(
    async (
      userId: string,
      data: { displayName?: string; email?: string; role?: UserRole }
    ): Promise<AppError | null> => {
      const result = await apiRef.current.updateUser(userId, data);
      if (result.ok) {
        const updated = result.value.data;
        setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, ...updated } : u)));
        // Re-fetch to reconcile with server state.
        await loadUsers();
        return null;
      }
      return result.error;
    },
    [loadUsers]
  );

  // --- Team actions ---

  const createTeam = useCallback(async (name: string) => {
    const result = await apiRef.current.createTeam({ name });
    if (result.ok) {
      setTeams((prev) => [...prev, result.value.data]);
      setTeamMembers((prev) => ({ ...prev, [result.value.data.teamId]: [] }));
    }
  }, []);

  const editTeam = useCallback(async (teamId: string, name: string) => {
    const result = await apiRef.current.updateTeam(teamId, { name });
    if (result.ok) {
      setTeams((prev) => prev.map((t) => t.teamId === teamId ? { ...t, name } : t));
    }
  }, []);

  const deleteTeam = useCallback(async (teamId: string) => {
    const result = await apiRef.current.deleteTeam(teamId);
    if (result.ok) {
      setTeams((prev) => prev.filter((t) => t.teamId !== teamId));
      setTeamMembers((prev) => {
        const next = { ...prev };
        delete next[teamId];
        return next;
      });
    }
  }, []);

  const addMember = useCallback(async (teamId: string, userId: string) => {
    const result = await apiRef.current.addTeamMember(teamId, userId);
    if (result.ok) {
      setTeamMembers((prev) => ({
        ...prev,
        [teamId]: [...(prev[teamId] ?? []), userId],
      }));
    }
  }, []);

  const removeMember = useCallback(async (teamId: string, userId: string) => {
    const result = await apiRef.current.removeTeamMember(teamId, userId);
    if (result.ok) {
      setTeamMembers((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).filter((id) => id !== userId),
      }));
    }
  }, []);

  const assignSession = useCallback(async (teamId: string, sessionId: string) => {
    const result = await apiRef.current.assignSession(teamId, sessionId);
    if (result.ok) {
      setTeamAssignments((prev) => [...prev, result.value.data]);
    } else {
      setError(result.error);
    }
  }, []);

  const unassignSession = useCallback(async (teamId: string, sessionId: string) => {
    const result = await apiRef.current.unassignSession(teamId, sessionId);
    if (result.ok) {
      setTeamAssignments((prev) =>
        prev.filter((a) => !(a.teamId === teamId && a.sessionId === sessionId))
      );
    } else {
      setError(result.error);
    }
  }, []);

  // --- IP Allowlist actions ---

  const addIPEntry = useCallback(async (data: { cidr: string; description: string }) => {
    const result = await apiRef.current.addIPEntry(data);
    if (result.ok) {
      setIpAllowlistEntries((prev) => [...prev, result.value.data]);
    }
  }, []);

  const deleteIPEntry = useCallback(async (entryId: string) => {
    const result = await apiRef.current.deleteIPEntry(entryId);
    if (result.ok) {
      setIpAllowlistEntries((prev) => prev.filter((e) => e.entryId !== entryId));
    }
  }, []);

  // --- Audit Log actions ---

  const onAuditLogFilterChange = useCallback((filters: AuditLogFilters) => {
    const params: AuditLogSearchParams = {
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      actorName: filters.actorName || undefined,
      operationType: filters.operationType || undefined,
      page: 1,
    };
    setAuditLogFilters(params);
    loadAuditLogs(params);
  }, [loadAuditLogs]);

  const onAuditLogPageChange = useCallback((page: number) => {
    const params = { ...auditLogFilters, page };
    setAuditLogFilters(params);
    loadAuditLogs(params);
  }, [auditLogFilters, loadAuditLogs]);

  const deleteAuditLogs = useCallback(async (filters: AuditLogFilters) => {
    const result = await apiRef.current.deleteAuditLogs({
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      actorName: filters.actorName || undefined,
      operationType: filters.operationType || undefined,
    });
    if (result.ok) {
      // Reload audit logs after deletion
      await loadAuditLogs(auditLogFilters);
    }
  }, [auditLogFilters, loadAuditLogs]);

  return {
    users,
    teams,
    sessions,
    teamMembers,
    teamAssignments,
    ipAllowlistEntries,
    auditLogs,
    auditLogTotalCount,
    auditLogCurrentPage,
    isLoading,
    error,
    createUser,
    syncUser,
    disableUser,
    enableUser,
    editUser,
    createTeam,
    editTeam,
    deleteTeam,
    addMember,
    removeMember,
    assignSession,
    unassignSession,
    addIPEntry,
    deleteIPEntry,
    onAuditLogFilterChange,
    onAuditLogPageChange,
    deleteAuditLogs,
  };
}
