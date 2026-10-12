import { useEffect, useState } from 'react';
import type { ReviewSession } from '../types/session';
import type { UserRole } from '../types/user';
import type { Team, TeamMembership } from '../types/team';

export interface SessionAssignmentControlsProps {
  session: ReviewSession;
  userRole: UserRole;
  /** 現在のユーザー ID（自分が引き受け済みか判定するため） */
  currentUserId: string;
  /**
   * 一覧の種類。未指定（既定）時は従来どおり「未引き受けなら引き受けボタン」を表示する。
   * 'joinable' のときのみ「参加」ボタンの表示条件を候補一覧向けに切り替える。
   */
  scope?: 'all' | 'assigned' | 'joinable';
  /** レビュアーがセッションを引き受ける / 参加する */
  onClaim?: (sessionId: string) => Promise<void>;
  /** Admin/TeamLeader がユーザーまたはチームに割り当てる */
  onAssign?: (
    sessionId: string,
    input: { assignedUserId?: string; assignedTeamId?: string }
  ) => Promise<void>;
  /** 割り当て先の選択肢となるチーム一覧（Admin/TeamLeader のスコープ内） */
  teams?: Team[];
  /** 指定チームのメンバー一覧を取得する（ユーザー割り当てドロップダウン用） */
  loadTeamMembers?: (teamId: string) => Promise<TeamMembership[]>;
}

type AssignMode = 'team' | 'user';

/**
 * SessionAssignmentControls - セッションの引き受け／割り当て操作
 *
 * - Reviewer: 未引き受けかつ自チームのセッションに「引き受ける」ボタンを表示
 * - Admin / TeamLeader: 「割り当て」フォーム（チーム／ユーザーをドロップダウンで選択）
 *
 * 権限・スコープの最終検証はバックエンドで行う。ここでは操作の入口のみ提供する。
 */
export function SessionAssignmentControls({
  session,
  userRole,
  currentUserId,
  scope,
  onClaim,
  onAssign,
  teams = [],
  loadTeamMembers,
}: SessionAssignmentControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [mode, setMode] = useState<AssignMode>('team');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [members, setMembers] = useState<TeamMembership[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [prevSel, setPrevSel] = useState('');

  // モード/チームの選択が変わったらメンバー一覧をリセットする（レンダー時に state を
  // 調整）。ユーザーモードでチームが選ばれている場合はローディングを開始する。
  const selKey = `${mode}|${selectedTeamId ?? ''}`;
  if (prevSel !== selKey) {
    setPrevSel(selKey);
    setMembers([]);
    setSelectedUserId('');
    setMembersLoading(mode === 'user' && !!selectedTeamId && !!loadTeamMembers);
  }

  const canManage = userRole === 'ADMIN' || userRole === 'TEAM_LEADER';
  const isClaimed = Boolean(session.assignedUserId);
  const claimedByMe = session.assignedUserId === currentUserId;

  // 候補一覧（joinable）では、自動生成セッション（アップローダーが assignedUserId に
  // 入る）でも他のレビュアーが参加できるよう、表示条件を切り替える。候補一覧 API が
  // サーバ側で「未参加」をフィルタ済みのため、UI は軽量条件で足りる（二重登録しても
  // サーバ側 addParticipant が冪等）。未指定スコープでは従来挙動を 1 ビットも変えない。
  const isJoinableScope = scope === 'joinable';
  const isJoinableCandidate =
    session.status === 'PENDING' &&
    Boolean(session.assignedTeamId) &&
    session.assignedUserId !== currentUserId;
  const showClaimButton = Boolean(
    onClaim && (isJoinableScope ? isJoinableCandidate : !isClaimed)
  );

  // ユーザー割り当てモードでチームが選ばれたら、そのチームのメンバーを取得する。
  // state のリセット/ローディング開始はレンダー時に行い、ここでは非同期取得のみ行う。
  useEffect(() => {
    if (mode !== 'user' || !selectedTeamId || !loadTeamMembers) {
      return;
    }
    let cancelled = false;
    loadTeamMembers(selectedTeamId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedTeamId, loadTeamMembers]);

  const handleClaim = async () => {
    if (!onClaim) return;
    setBusy(true);
    setError(null);
    try {
      await onClaim(session.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '引き受けに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const resetAssignForm = () => {
    setSelectedTeamId('');
    setSelectedUserId('');
    setMembers([]);
    setMode('team');
  };

  const handleAssign = async () => {
    if (!onAssign) return;
    if (mode === 'team') {
      if (!selectedTeamId) {
        setError('割り当て先のチームを選択してください。');
        return;
      }
    } else if (!selectedUserId) {
      setError('割り当て先のユーザーを選択してください。');
      return;
    }

    const input =
      mode === 'team'
        ? { assignedTeamId: selectedTeamId }
        : { assignedUserId: selectedUserId };

    setBusy(true);
    setError(null);
    try {
      await onAssign(session.sessionId, input);
      setShowAssign(false);
      resetAssignForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '割り当てに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const memberLabel = (m: TeamMembership) =>
    m.displayName ? `${m.displayName}${m.email ? ` (${m.email})` : ''}` : m.userId;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Assignment status */}
      <p className="text-xs text-gray-500">
        {isClaimed
          ? claimedByMe
            ? '自分が引き受け中'
            : `割り当て済み（${session.assignedUserId}）`
          : session.assignedTeamId
            ? `チーム ${session.assignedTeamId} に割り当て（未引き受け）`
            : '未割り当て'}
      </p>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="担当の割り当て・引き受け操作"
      >
        {/* Reviewer claim / self-assign */}
        {showClaimButton && (
          <button
            type="button"
            onClick={handleClaim}
            disabled={busy}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {isJoinableScope ? '参加' : '引き受ける'}
          </button>
        )}

        {/* Admin / TeamLeader assign toggle */}
        {canManage && onAssign && (
          <button
            type="button"
            onClick={() => {
              setShowAssign((v) => !v);
              setError(null);
            }}
            aria-expanded={showAssign}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            担当者を割り当て
          </button>
        )}
      </div>

      {/* Assign form */}
      {canManage && onAssign && showAssign && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 flex flex-col gap-3">
          {/* Mode selector */}
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label="割り当て先の種類"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'team'}
              onClick={() => {
                setMode('team');
                setError(null);
              }}
              className={`px-3 py-1 text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                mode === 'team'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              チームに割り当て
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'user'}
              onClick={() => {
                setMode('user');
                setError(null);
              }}
              className={`px-3 py-1 text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                mode === 'user'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              ユーザーに割り当て
            </button>
          </div>

          {/* Team dropdown (always shown; also used to scope member list) */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`assign-team-${session.sessionId}`}
              className="text-xs font-medium text-gray-700"
            >
              チーム
            </label>
            <select
              id={`assign-team-${session.sessionId}`}
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="px-2 py-1 text-sm rounded border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">チームを選択</option>
              {teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>

          {/* User dropdown (only in user mode) */}
          {mode === 'user' && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`assign-user-${session.sessionId}`}
                className="text-xs font-medium text-gray-700"
              >
                メンバー
              </label>
              <select
                id={`assign-user-${session.sessionId}`}
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={!selectedTeamId || membersLoading}
                className="px-2 py-1 text-sm rounded border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">
                  {!selectedTeamId
                    ? '先にチームを選択'
                    : membersLoading
                      ? '読み込み中...'
                      : members.length === 0
                        ? 'メンバーがいません'
                        : 'メンバーを選択'}
                </option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={handleAssign}
              disabled={busy}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              割り当てを保存
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
