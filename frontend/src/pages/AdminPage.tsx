import { useState } from 'react';
import { UserManagement } from '../components/UserManagement';
import { TeamManagement } from '../components/TeamManagement';
import { IPAllowlistSettings } from '../components/IPAllowlistSettings';
import { AuditLogViewer } from '../components/AuditLogViewer';
import type { AuditLogFilters } from '../components/AuditLogViewer';
import type { User, UserRole } from '../types/user';
import type { Team, TeamAssignment } from '../types/team';
import type { ReviewSession } from '../types/session';
import type { IPAllowlistEntry, AuditLog } from '../types/audit';
import type { AppError } from '../types/api';

export interface AdminPageProps {
  users: User[];
  teams: Team[];
  sessions: ReviewSession[];
  teamMembers: Record<string, string[]>;
  teamAssignments: TeamAssignment[];
  ipAllowlistEntries?: IPAllowlistEntry[];
  auditLogs?: AuditLog[];
  auditLogTotalCount?: number;
  auditLogCurrentPage?: number;
  isLoading?: boolean;
  onCreateUser?: (data: { email: string; displayName: string; role: UserRole }) => void;
  onDisableUser?: (userId: string) => void;
  onEnableUser?: (userId: string) => void;
  onEditUser?: (
    userId: string,
    data: { displayName?: string; email?: string; role?: UserRole }
  ) => Promise<AppError | null>;
  currentUserId?: string;
  onCreateTeam?: (name: string) => void;
  onEditTeam?: (teamId: string, name: string) => void;
  onDeleteTeam?: (teamId: string) => void;
  onAddMember?: (teamId: string, userId: string) => void;
  onRemoveMember?: (teamId: string, userId: string) => void;
  onAssignSession?: (teamId: string, sessionId: string) => void;
  onUnassignSession?: (teamId: string, sessionId: string) => void;
  onAddIPEntry?: (data: { cidr: string; description: string }) => void;
  onDeleteIPEntry?: (entryId: string) => void;
  onAuditLogFilterChange?: (filters: AuditLogFilters) => void;
  onAuditLogPageChange?: (page: number) => void;
  onDeleteAuditLogs?: (filters: AuditLogFilters) => void;
}

type AdminTab = 'users' | 'teams' | 'ip-allowlist' | 'audit-logs';

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'users', label: 'ユーザー管理' },
  { id: 'teams', label: 'チーム管理' },
  { id: 'ip-allowlist', label: 'IPアドレス制限' },
  { id: 'audit-logs', label: '監査ログ' },
];

/**
 * AdminPage - 管理画面（タブナビゲーション付き）
 *
 * Requirements: 9.2, 13.1, 13.4, 14.3, 14.11, 14.13
 */
export function AdminPage({
  users,
  teams,
  sessions,
  teamMembers,
  teamAssignments,
  ipAllowlistEntries = [],
  auditLogs = [],
  auditLogTotalCount = 0,
  auditLogCurrentPage = 1,
  isLoading = false,
  onCreateUser,
  onDisableUser,
  onEnableUser,
  onEditUser,
  currentUserId,
  onCreateTeam,
  onEditTeam,
  onDeleteTeam,
  onAddMember,
  onRemoveMember,
  onAssignSession,
  onUnassignSession,
  onAddIPEntry,
  onDeleteIPEntry,
  onAuditLogFilterChange,
  onAuditLogPageChange,
  onDeleteAuditLogs,
}: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  return (
    <div className="flex flex-col h-full" role="main" aria-label="管理画面">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">管理画面</h1>
      </div>

      {/* Tab navigation */}
      <div
        className="flex border-b border-gray-200 bg-white px-4 overflow-x-auto"
        role="tablist"
        aria-label="管理画面タブ"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        <div
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === 'users' && (
            <UserManagement
              users={users}
              isLoading={isLoading}
              onCreateUser={onCreateUser}
              onDisableUser={onDisableUser}
              onEnableUser={onEnableUser}
              onEditUser={onEditUser}
              currentUserId={currentUserId}
            />
          )}
          {activeTab === 'teams' && (
            <TeamManagement
              teams={teams}
              users={users}
              sessions={sessions}
              teamMembers={teamMembers}
              teamAssignments={teamAssignments}
              isLoading={isLoading}
              onCreateTeam={onCreateTeam}
              onEditTeam={onEditTeam}
              onDeleteTeam={onDeleteTeam}
              onAddMember={onAddMember}
              onRemoveMember={onRemoveMember}
              onAssignSession={onAssignSession}
              onUnassignSession={onUnassignSession}
            />
          )}
          {activeTab === 'ip-allowlist' && (
            <IPAllowlistSettings
              entries={ipAllowlistEntries}
              isLoading={isLoading}
              onAddEntry={onAddIPEntry}
              onDeleteEntry={onDeleteIPEntry}
            />
          )}
          {activeTab === 'audit-logs' && (
            <AuditLogViewer
              logs={auditLogs}
              totalCount={auditLogTotalCount}
              currentPage={auditLogCurrentPage}
              isLoading={isLoading}
              onFilterChange={onAuditLogFilterChange}
              onPageChange={onAuditLogPageChange}
              onDeleteLogs={onDeleteAuditLogs}
            />
          )}
        </div>
      </div>
    </div>
  );
}
