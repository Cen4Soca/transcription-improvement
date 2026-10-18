import { useState } from 'react';
import type { Team, TeamAssignment } from '../types/team';
import type { User } from '../types/user';
import type { ReviewSession } from '../types/session';

export interface TeamManagementProps {
  teams: Team[];
  users: User[];
  sessions: ReviewSession[];
  teamMembers: Record<string, string[]>; // teamId -> userId[]
  teamAssignments: TeamAssignment[];
  isLoading?: boolean;
  onCreateTeam?: (name: string) => void;
  onEditTeam?: (teamId: string, name: string) => void;
  onDeleteTeam?: (teamId: string) => void;
  onAddMember?: (teamId: string, userId: string) => void;
  onRemoveMember?: (teamId: string, userId: string) => void;
  onAssignSession?: (teamId: string, sessionId: string) => void;
  onUnassignSession?: (teamId: string, sessionId: string) => void;
}

/**
 * TeamManagement - チーム作成・編集・削除・メンバー管理コンポーネント
 *
 * Requirements: 13.1, 13.4
 */
export function TeamManagement({
  teams,
  users,
  sessions,
  teamMembers,
  teamAssignments,
  isLoading = false,
  onCreateTeam,
  onEditTeam,
  onDeleteTeam,
  onAddMember,
  onRemoveMember,
  onAssignSession,
  onUnassignSession,
}: TeamManagementProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [confirmDeleteTeamId, setConfirmDeleteTeamId] = useState<string | null>(null);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [showAssignmentSection, setShowAssignmentSection] = useState<string | null>(null);

  const handleCreateTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    onCreateTeam?.(newTeamName.trim());
    setNewTeamName('');
    setShowCreateForm(false);
  };

  const handleEditSubmit = (teamId: string) => {
    if (!editingTeamName.trim()) return;
    onEditTeam?.(teamId, editingTeamName.trim());
    setEditingTeamId(null);
    setEditingTeamName('');
  };

  const handleDeleteConfirm = (teamId: string) => {
    onDeleteTeam?.(teamId);
    setConfirmDeleteTeamId(null);
  };

  const getTeamMemberUsers = (teamId: string): User[] => {
    const memberIds = teamMembers[teamId] || [];
    return users.filter((u) => memberIds.includes(u.userId));
  };

  const getNonMemberUsers = (teamId: string): User[] => {
    const memberIds = teamMembers[teamId] || [];
    return users.filter((u) => !memberIds.includes(u.userId) && u.isActive);
  };

  const getTeamAssignments = (teamId: string): TeamAssignment[] => {
    return teamAssignments.filter((a) => a.teamId === teamId);
  };

  const getUnassignedSessions = (teamId: string): ReviewSession[] => {
    const assignedSessionIds = getTeamAssignments(teamId).map((a) => a.sessionId);
    return sessions.filter((s) => !assignedSessionIds.includes(s.sessionId));
  };

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-48"
        role="status"
        aria-label="読み込み中"
      >
        <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="チーム管理">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">チーム一覧</h2>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-expanded={showCreateForm}
          aria-controls="create-team-form"
        >
          {showCreateForm ? 'キャンセル' : 'チーム作成'}
        </button>
      </div>

      {/* Create team form */}
      {showCreateForm && (
        <form
          id="create-team-form"
          onSubmit={handleCreateTeam}
          className="p-4 bg-gray-50 border border-gray-200 rounded-lg flex gap-2 items-end"
          aria-label="チーム作成フォーム"
        >
          <div className="flex-1">
            <label htmlFor="team-name" className="block text-sm font-medium text-gray-700">
              チーム名
            </label>
            <input
              id="team-name"
              type="text"
              required
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="チーム名を入力"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            作成
          </button>
        </form>
      )}

      {/* Team list */}
      {teams.length === 0 ? (
        <p className="text-center text-gray-500 py-8">チームがありません</p>
      ) : (
        <ul className="space-y-3" aria-label="チーム一覧">
          {teams.map((team) => {
            const members = getTeamMemberUsers(team.teamId);
            const isExpanded = expandedTeamId === team.teamId;
            const isAssignmentOpen = showAssignmentSection === team.teamId;

            return (
              <li
                key={team.teamId}
                className="border border-gray-200 rounded-lg bg-white overflow-hidden"
              >
                {/* Team header */}
                <div className="px-4 py-3 flex items-center justify-between">
                  {editingTeamId === team.teamId ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={editingTeamName}
                        onChange={(e) => setEditingTeamName(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="チーム名を編集"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleEditSubmit(team.teamId)}
                        className="text-sm text-green-600 hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 rounded px-2 py-1"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTeamId(null)}
                        className="text-sm text-gray-600 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded px-2 py-1"
                      >
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedTeamId(isExpanded ? null : team.teamId)}
                        className="font-medium text-gray-900 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                        aria-expanded={isExpanded}
                        aria-controls={`team-details-${team.teamId}`}
                      >
                        {team.name}
                      </button>
                      <span className="text-xs text-gray-500">
                        {members.length}名
                      </span>
                    </div>
                  )}

                  {editingTeamId !== team.teamId && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTeamId(team.teamId);
                          setEditingTeamName(team.name);
                        }}
                        className="text-sm text-gray-600 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
                        aria-label={`${team.name}を編集`}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAssignmentSection(isAssignmentOpen ? null : team.teamId)}
                        className="text-sm text-gray-600 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
                        aria-label={`${team.name}にセッション割り当て`}
                      >
                        割り当て
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteTeamId(team.teamId)}
                        className="text-sm text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-1"
                        aria-label={`${team.name}を削除`}
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded team details - members */}
                {isExpanded && (
                  <div
                    id={`team-details-${team.teamId}`}
                    className="border-t border-gray-200 px-4 py-3 bg-gray-50"
                  >
                    <h4 className="text-sm font-medium text-gray-700 mb-2">メンバー</h4>
                    {members.length === 0 ? (
                      <p className="text-sm text-gray-500">メンバーがいません</p>
                    ) : (
                      <ul className="space-y-1 mb-3" aria-label={`${team.name}のメンバー`}>
                        {members.map((member) => (
                          <li
                            key={member.userId}
                            className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-100"
                          >
                            <span className="text-sm text-gray-900">
                              {member.displayName}
                              <span className="ml-2 text-xs text-gray-500">{member.email}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => onRemoveMember?.(team.teamId, member.userId)}
                              className="text-xs text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-0.5"
                              aria-label={`${member.displayName}をチームから削除`}
                            >
                              削除
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Add member */}
                    <AddMemberSelect
                      teamId={team.teamId}
                      availableUsers={getNonMemberUsers(team.teamId)}
                      onAddMember={onAddMember}
                    />
                  </div>
                )}

                {/* Team assignment section */}
                {isAssignmentOpen && (
                  <div className="border-t border-gray-200 px-4 py-3 bg-blue-50">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">セッション割り当て</h4>

                    {/* Current assignments */}
                    {getTeamAssignments(team.teamId).length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs text-gray-500 mb-1">割り当て済み</p>
                        <ul className="space-y-1" aria-label={`${team.name}の割り当て済みセッション`}>
                          {getTeamAssignments(team.teamId).map((assignment) => {
                            const session = sessions.find((s) => s.sessionId === assignment.sessionId);
                            return (
                              <li
                                key={assignment.sessionId}
                                className="flex items-center justify-between py-1 px-2 rounded bg-white"
                              >
                                <span className="text-sm text-gray-900">
                                  {session?.name || assignment.sessionId}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onUnassignSession?.(team.teamId, assignment.sessionId)}
                                  className="text-xs text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-0.5"
                                  aria-label={`${session?.name || assignment.sessionId}の割り当てを解除`}
                                >
                                  解除
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {/* Assign new session */}
                    <AssignSessionSelect
                      teamId={team.teamId}
                      availableSessions={getUnassignedSessions(team.teamId)}
                      onAssignSession={onAssignSession}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Delete confirmation dialog */}
      {confirmDeleteTeamId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-team-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 id="delete-team-dialog-title" className="text-lg font-semibold text-gray-900">
              チーム削除の確認
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              このチームを削除しますか？チームの割り当てもすべて削除されます。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTeamId(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConfirm(confirmDeleteTeamId)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddMemberSelect({
  teamId,
  availableUsers,
  onAddMember,
}: {
  teamId: string;
  availableUsers: User[];
  onAddMember?: (teamId: string, userId: string) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState('');

  const handleAdd = () => {
    if (!selectedUserId) return;
    onAddMember?.(teamId, selectedUserId);
    setSelectedUserId('');
  };

  if (availableUsers.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedUserId}
        onChange={(e) => setSelectedUserId(e.target.value)}
        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="追加するメンバーを選択"
      >
        <option value="">メンバーを選択...</option>
        {availableUsers.map((user) => (
          <option key={user.userId} value={user.userId}>
            {user.displayName} ({user.email})
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleAdd}
        disabled={!selectedUserId}
        className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        追加
      </button>
    </div>
  );
}

function AssignSessionSelect({
  teamId,
  availableSessions,
  onAssignSession,
}: {
  teamId: string;
  availableSessions: ReviewSession[];
  onAssignSession?: (teamId: string, sessionId: string) => void;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState('');

  const handleAssign = () => {
    if (!selectedSessionId) return;
    onAssignSession?.(teamId, selectedSessionId);
    setSelectedSessionId('');
  };

  if (availableSessions.length === 0) {
    return <p className="text-xs text-gray-500">割り当て可能なセッションがありません</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedSessionId}
        onChange={(e) => setSelectedSessionId(e.target.value)}
        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="割り当てるセッションを選択"
      >
        <option value="">セッションを選択...</option>
        {availableSessions.map((session) => (
          <option key={session.sessionId} value={session.sessionId}>
            {session.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleAssign}
        disabled={!selectedSessionId}
        className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        割り当て
      </button>
    </div>
  );
}
