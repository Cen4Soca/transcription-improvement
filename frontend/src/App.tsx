import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { LoginForm } from './components/LoginForm';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Navigation } from './components/Navigation';
import { OfflineBanner } from './components/OfflineBanner';
import { SessionTimeoutWarning } from './components/SessionTimeoutWarning';
import { SessionListPage } from './pages/SessionListPage';
import type { FilterStatus, PaginationInfo } from './pages/SessionListPage';
import { SessionAssignmentControls } from './components/SessionAssignmentControls';
import { SessionAggregateControls } from './components/SessionAggregateControls';
import { SessionReopenControls } from './components/SessionReopenControls';
import { ReviewPage } from './pages/ReviewPage';
import { AdminPage } from './pages/AdminPage';
import { RankingPage } from './pages/RankingPage';
import { ConsensusPage } from './pages/ConsensusPage';
import { MediaUploadPage } from './pages/MediaUploadPage';
import { MediaFileList } from './components/MediaFileList';
import { TranscriptionJobForm } from './components/TranscriptionJobForm';
import { LanguageModelPage } from './pages/LanguageModelPage';
import { ProfilePage } from './pages/ProfilePage';
import { useAuth } from './hooks/useAuth';
import { useAdmin } from './hooks/useAdmin';
import { useLanguageModels } from './hooks/useLanguageModels';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { ApiClient } from './services/api-client';
import { AdminApi } from './services/admin-api';
import { SessionApi } from './services/session-api';
import { RankingApi } from './services/ranking-api';
import { ConsensusApi } from './services/consensus-api';
import { TranscriptionApi } from './services/transcription-api';
import { DeletionApi } from './services/deletion-api';
import { CorrectionApi, type CreateCorrectionInput } from './services/correction-api';
import { SuggestionApi } from './services/suggestion-api';
import { LanguageModelApi } from './services/language-model-api';
import { MediaApi } from './services/media-api';
import type { MediaFile } from './services/media-api';
import { ProfileApi } from './services/profile-api';
import type { AuthUser } from './types/auth';
import type { AppError } from './types/api';
import type { UserRole } from './types/user';
import type { ReviewSession, ReviewSessionStatus, ForceAggregateResult, ReopenSessionResult } from './types/session';
import type { Team, TeamMembership } from './types/team';
import type { Segment } from './types/segment';
import type { RankingPeriod } from './types/ranking';
import type { ConsensusSegment } from './types/consensus';
import { describeAggregateError } from './utils/aggregate-error';
import { describeReopenError } from './utils/reopen-error';

/**
 * getApiBaseUrl - 共通のAPIベースURL取得ヘルパー
 */
function getApiBaseUrl(): string {
  return (window as unknown as Record<string, string>).__API_ENDPOINT__
    || import.meta.env.VITE_API_ENDPOINT || import.meta.env.VITE_API_BASE_URL || '';
}

/** correctionId を生成する（crypto.randomUUID が使えない環境向けフォールバック付き） */
function generateCorrectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * SessionListPageWrapper - SessionListPage をルーティングに接続するラッパー
 * バックエンド GET /sessions を呼び出してデータを取得する
 */
export function SessionListPageWrapper({
  getToken,
  userRole,
  userId,
  scope = 'all',
  title,
}: {
  getToken: () => Promise<string>;
  userRole?: UserRole;
  userId?: string;
  /**
   * 'all' = GET /sessions（アクセス可能な全件）,
   * 'assigned' = GET /sessions/assigned（自分の担当）,
   * 'joinable' = GET /sessions/joinable（自分が参加可能な候補）
   */
  scope?: 'all' | 'assigned' | 'joinable';
  title?: string;
}) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  // 'all' スコープ専用のサーバー駆動 state（RankingPageWrapper と同じパターン）。
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo | undefined>();

  const canManage = userRole === 'ADMIN' || userRole === 'TEAM_LEADER';

  const sessionApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new SessionApi(client);
  }, [getToken]);

  const adminApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new AdminApi(client);
  }, [getToken]);

  // Admin / TeamLeader 向けに割り当て先チームの選択肢を取得する。
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    adminApi.getTeams().then((result) => {
      if (!cancelled && result.ok) {
        setTeams(result.value.data);
      }
    });
    return () => { cancelled = true; };
  }, [canManage, adminApi]);

  const loadTeamMembers = useCallback(
    async (teamId: string): Promise<TeamMembership[]> => {
      const result = await adminApi.getTeamMembers(teamId);
      return result.ok ? result.value.data : [];
    },
    [adminApi]
  );

  const loadSessions = useCallback(async () => {
    if (scope === 'assigned') {
      const result = await sessionApi.listAssignedSessions();
      if (result.ok) {
        setSessions(result.value.data.items);
        setPagination(undefined);
        setError(null);
      } else {
        setError({ message: result.error.message });
      }
      return;
    }
    if (scope === 'joinable') {
      const result = await sessionApi.listJoinableSessions();
      if (result.ok) {
        setSessions(result.value.data.items);
        setPagination(undefined);
        setError(null);
      } else {
        setError({ message: result.error.message });
      }
      return;
    }
    // 'all' スコープ: サーバー側のフィルター＋ページングを尊重する。
    const result = await sessionApi.listSessions({
      status: selectedStatus === 'ALL' ? undefined : selectedStatus,
      page: currentPage,
    });
    if (result.ok) {
      setSessions(result.value.items);
      setPagination(result.value.pagination);
      setError(null);
    } else {
      setError({ message: result.error.message });
    }
  }, [sessionApi, scope, selectedStatus, currentPage]);

  useEffect(() => {
    let cancelled = false;
    async function fetchSessions() {
      setIsLoading(true);
      await loadSessions();
      if (!cancelled) setIsLoading(false);
    }
    fetchSessions();
    return () => { cancelled = true; };
  }, [loadSessions]);

  const handleSessionSelect = (sessionId: string) => {
    navigate(`/sessions/${sessionId}`);
  };

  // ステータス変更時は 1 ページ目に戻してから再取得する（再取得は loadSessions の
  // 依存配列経由で mount effect が再実行される）。
  const handleStatusChange = useCallback((status: FilterStatus) => {
    setSelectedStatus(status);
    setCurrentPage(1);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleClaim = useCallback(
    async (sessionId: string) => {
      const result = await sessionApi.claimSession(sessionId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      await loadSessions();
    },
    [sessionApi, loadSessions]
  );

  const handleSelfAssign = useCallback(
    async (sessionId: string) => {
      const result = await sessionApi.selfAssignSession(sessionId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      // 成功後に候補一覧を再取得し、参加済みセッションを候補から外す。
      await loadSessions();
    },
    [sessionApi, loadSessions]
  );

  const handleAssign = useCallback(
    async (
      sessionId: string,
      input: { assignedUserId?: string; assignedTeamId?: string }
    ) => {
      const result = await sessionApi.assignSession(sessionId, input);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      await loadSessions();
    },
    [sessionApi, loadSessions]
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, name: string): Promise<AppError | null> => {
      const result = await sessionApi.renameSession(sessionId, name);
      if (result.ok) {
        await loadSessions();
        return null;
      }
      return result.error;
    },
    [sessionApi, loadSessions]
  );

  const handleForceAggregate = useCallback(
    async (sessionId: string): Promise<ForceAggregateResult> => {
      const result = await sessionApi.forceAggregateSession(sessionId);
      if (!result.ok) {
        throw new Error(describeAggregateError(result.error));
      }
      // 成功後に一覧を再取得し、セッションを COMPLETED として反映する。
      await loadSessions();
      return result.value.data;
    },
    [sessionApi, loadSessions]
  );

  const handleReopen = useCallback(
    async (sessionId: string): Promise<ReopenSessionResult> => {
      const result = await sessionApi.reopenSession(sessionId);
      if (!result.ok) {
        throw new Error(describeReopenError(result.error));
      }
      // 成功後に一覧を再取得し、セッションを IN_PROGRESS として反映する。
      await loadSessions();
      return result.value.data;
    },
    [sessionApi, loadSessions]
  );

  const renderSessionActions = useCallback(
    (session: ReviewSession) => {
      if (!userRole) return null;
      return (
        <>
          <SessionAssignmentControls
            session={session}
            userRole={userRole}
            currentUserId={userId ?? ''}
            scope={scope}
            onClaim={scope === 'joinable' ? handleSelfAssign : handleClaim}
            onAssign={canManage ? handleAssign : undefined}
            teams={canManage ? teams : undefined}
            loadTeamMembers={canManage ? loadTeamMembers : undefined}
          />
          {canManage && (
            <SessionAggregateControls
              session={session}
              userRole={userRole}
              onAggregate={handleForceAggregate}
            />
          )}
          {canManage && (
            <SessionReopenControls
              session={session}
              userRole={userRole}
              onReopen={handleReopen}
            />
          )}
        </>
      );
    },
    [userRole, userId, scope, handleClaim, handleSelfAssign, handleAssign, canManage, teams, loadTeamMembers, handleForceAggregate, handleReopen]
  );

  // 'all' スコープのみサーバー駆動の制御 props を渡す。assigned/joinable は
  // これらを undefined のままにして非制御フォールバック（ローカルフィルター／ページ UI 非表示）にする。
  const isAllScope = scope === 'all';

  return (
    <SessionListPage
      title={title}
      sessions={sessions}
      isLoading={isLoading}
      error={error}
      onSessionSelect={handleSessionSelect}
      renderSessionActions={renderSessionActions}
      onRenameSession={handleRenameSession}
      selectedStatus={isAllScope ? selectedStatus : undefined}
      onStatusChange={isAllScope ? handleStatusChange : undefined}
      pagination={isAllScope ? pagination : undefined}
      onPageChange={isAllScope ? handlePageChange : undefined}
    />
  );
}

/**
 * MediaFile の contentType とファイル名からメディア種別を判定する。
 * contentType (例: video/mp4, audio/mpeg) を最優先し、無ければ拡張子で判定する。
 * 判定できない場合は undefined を返し、MediaPlayer 側の URL 自動判定に委ねる。
 */
function resolveMediaType(
  contentType?: string,
  filename?: string
): 'audio' | 'video' | undefined {
  const ct = contentType?.toLowerCase() ?? '';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';

  const videoExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
  const name = filename?.toLowerCase() ?? '';
  if (videoExtensions.some((ext) => name.endsWith(ext))) return 'video';

  const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
  if (audioExtensions.some((ext) => name.endsWith(ext))) return 'audio';

  return undefined;
}

/**
 * メディアURL取得エラーを校閲者向けの日本語メッセージに変換する。
 * バックエンドのエラーコード / HTTP ステータスに応じて理由を具体化し、
 * 何も分からない「無音の失敗」を避ける。
 */
function describeMediaUrlError(error: AppError): string {
  const status = error.statusCode;
  const code = error.code;

  if (status === 404 || code === 'NOT_FOUND') {
    return 'メディアファイルが見つかりません。このセッションには再生可能なファイルが登録されていない可能性があります。';
  }
  if (status === 403 || code === 'FORBIDDEN') {
    return 'メディアファイルを再生できません。マルウェアスキャンが完了していないか、アクセスが許可されていない可能性があります。';
  }
  // その他（500 等）はサーバー側メッセージがあれば添える
  return error.message
    ? `メディアの読み込みに失敗しました: ${error.message}`
    : 'メディアの読み込みに失敗しました。';
}

/**
 * ReviewPageWrapper - ReviewPage をルーティングに接続するラッパー
 * バックエンド GET /sessions/{sessionId}/segments と GET /sessions/{sessionId} を呼び出す
 */
function ReviewPageWrapper({ getToken, userRole }: { getToken: () => Promise<string>; userRole?: UserRole }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  // サーバーから取得した素の Segment（Correction 適用前）
  const [baseSegments, setBaseSegments] = useState<Segment[]>([]);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [sessionName, setSessionName] = useState<string | undefined>();
  const [sessionStatus, setSessionStatus] = useState<ReviewSessionStatus | undefined>();
  const [mediaFileId, setMediaFileId] = useState<string | undefined>();
  const [mediaFileName, setMediaFileName] = useState<string | undefined>();
  const [mediaType, setMediaType] = useState<'audio' | 'video' | undefined>();
  const [mediaUnavailableReason, setMediaUnavailableReason] = useState<string | null>(null);
  const [isMediaDeleted, setIsMediaDeleted] = useState(false);
  // segmentId -> 最新の修正後テキスト（復元表示用, Req 3.3）
  const [appliedText, setAppliedText] = useState<Map<string, string>>(new Map());
  // segmentId -> 最新の話者ラベル（単一Segmentの話者変更, Req 2.10）
  const [appliedSpeaker, setAppliedSpeaker] = useState<Map<string, string>>(new Map());
  // 話者ラベル一括変更（oldLabel -> newLabel）の適用結果を baseSegments に反映するため保持 (Req 2.14)
  const [speakerRenames, setSpeakerRenames] = useState<Array<{ oldLabel: string; newLabel: string }>>([]);
  // 話者ラベルのマスタ一覧（セッション詳細から取得、追加/削除で更新）
  const [masterSpeakerLabels, setMasterSpeakerLabels] = useState<string[]>([]);

  const apis = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return {
      session: new SessionApi(client),
      transcription: new TranscriptionApi(client),
      deletion: new DeletionApi(client),
      correction: new CorrectionApi(client),
      suggestion: new SuggestionApi(client),
    };
  }, [getToken]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      try {
        // Fetch session detail and segments in parallel
        const [detailResult, segmentsResult] = await Promise.all([
          apis.session.getSessionDetail(sessionId!),
          apis.session.getSegments(sessionId!),
        ]);

        if (cancelled) return;

        if (detailResult.ok) {
          setSessionName(detailResult.value.data.session.name);
          setSessionStatus(detailResult.value.data.session.status);
          setMasterSpeakerLabels(detailResult.value.data.session.speakerLabels ?? []);
          if (detailResult.value.data.mediaFile) {
            const mf = detailResult.value.data.mediaFile;
            setMediaFileId(mf.mediaFileId);
            setMediaFileName(mf.filename);
            setMediaType(resolveMediaType(mf.contentType, mf.filename));
          }
          // メディアが削除済み（セッションにフラグあり、または mediaFile が存在しない）なら明示する
          if (
            detailResult.value.data.session.mediaFileDeleted ||
            !detailResult.value.data.mediaFile
          ) {
            setIsMediaDeleted(true);
          }
        }

        if (segmentsResult.ok) {
          setBaseSegments(segmentsResult.value.data.segments);
        } else {
          setError({ message: segmentsResult.error.message });
        }

        // Req 3.3, 3.4: 保存済み Correction を取得して復元。失敗しても未修正状態で開く。
        const correctionsResult = await apis.correction.listCorrections(sessionId!);
        if (!cancelled && correctionsResult.ok) {
          const latestText = new Map<string, string>();
          const latestSpeaker = new Map<string, string>();
          const renames: Array<{ oldLabel: string; newLabel: string }> = [];
          // API は作成時刻の昇順で返すため、後勝ちで最新の状態が残る
          for (const c of correctionsResult.value.data) {
            if (c.correctionType === 'TEXT') {
              latestText.set(c.segmentId, c.afterText);
            } else if (c.correctionType === 'SPEAKER' && c.afterSpeaker !== undefined) {
              latestSpeaker.set(c.segmentId, c.afterSpeaker);
            } else if (
              c.correctionType === 'SPEAKER_RENAME' &&
              c.beforeSpeaker !== undefined &&
              c.afterSpeaker !== undefined
            ) {
              renames.push({ oldLabel: c.beforeSpeaker, newLabel: c.afterSpeaker });
            }
          }
          setAppliedText(latestText);
          setAppliedSpeaker(latestSpeaker);
          setSpeakerRenames(renames);
        }

        // Fetch media URL
        const mediaUrlResult = await apis.session.getMediaUrl(sessionId!);
        if (!cancelled) {
          if (mediaUrlResult.ok) {
            setMediaUrl(mediaUrlResult.value.data.url);
            setMediaUnavailableReason(null);
          } else {
            // 403/404 等でURL取得に失敗した場合、理由を校閲画面に表示する（無音で握りつぶさない）
            setMediaUnavailableReason(describeMediaUrlError(mediaUrlResult.error));
          }
        }
      } catch {
        if (!cancelled) {
          setError({ message: 'データの取得に失敗しました。' });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [sessionId, apis]);

  // 復元済みの修正内容（テキスト・話者）を Segment に反映して表示する (Req 3.3, 2.10, 2.14)
  const segments = useMemo<Segment[]>(() => {
    // 一括リネームを記録順に畳み込むためのラベル変換マップを構築する
    const labelMap = new Map<string, string>();
    const resolveLabel = (label: string): string => {
      let current = label;
      // 連鎖するリネーム（A→B→C）を辿る。循環しない前提だが上限で保護。
      for (let i = 0; i < speakerRenames.length + 1 && labelMap.has(current); i++) {
        current = labelMap.get(current)!;
      }
      return current;
    };
    for (const { oldLabel, newLabel } of speakerRenames) {
      labelMap.set(oldLabel, newLabel);
    }

    return baseSegments.map((s) => {
      // 確定済みセグメント（強制確定含む）は Consensus の確定結果を表示し、
      // 個人 Correction（テキスト・話者）で上書きしない (force-confirm-consensus-display-fix)
      if (s.consensusStatus === 'CONFIRMED') {
        return s.consensusText !== undefined
          ? { ...s, originalText: s.consensusText }
          : s;
      }

      let next = s;
      // テキスト反映
      if (appliedText.has(s.segmentId)) {
        next = { ...next, originalText: appliedText.get(s.segmentId)! };
      }
      // 話者ラベル: 一括リネーム → 単一Segment変更 の順に適用
      let speaker = s.speakerLabel;
      if (speaker && labelMap.size > 0) {
        speaker = resolveLabel(speaker);
      }
      if (appliedSpeaker.has(s.segmentId)) {
        speaker = appliedSpeaker.get(s.segmentId)!;
      }
      if (speaker !== s.speakerLabel) {
        next = { ...next, speakerLabel: speaker };
      }
      return next;
    });
  }, [baseSegments, appliedText, appliedSpeaker, speakerRenames]);

  // 修正済み Segment の集合（未修正フィルタ用, Req 6.4）
  const correctedSegmentIds = useMemo(
    () => new Set(appliedText.keys()),
    [appliedText]
  );

  // 修正前/修正後の並列表示用の派生データ (Req 1, 2)。
  // baseSegments の originalText（上書き前の修正前テキスト）を正とし、
  // 実際にテキストが変化した Segment のみを対象にする（話者のみ変更は未修正扱い）。
  const displayCorrections = useMemo(() => {
    const map = new Map<string, { originalText: string; correctedText: string }>();
    for (const base of baseSegments) {
      const corrected = appliedText.get(base.segmentId);
      if (corrected !== undefined && corrected !== base.originalText) {
        map.set(base.segmentId, {
          originalText: base.originalText,
          correctedText: corrected,
        });
      }
    }
    return map;
  }, [baseSegments, appliedText]);

  // Correction 保存 (Req 3.1)。成功時にローカルの表示テキストも更新する。
  const handleSaveCorrection = useCallback(
    async (input: CreateCorrectionInput): Promise<boolean> => {
      if (!sessionId) return false;
      const result = await apis.correction.createCorrection(sessionId, input);
      if (!result.ok) return false;
      if (input.correctionType === 'TEXT' && input.segmentId) {
        setAppliedText((prev) => {
          const next = new Map(prev);
          next.set(input.segmentId, input.afterText);
          return next;
        });
      } else if (
        input.correctionType === 'SPEAKER' &&
        input.segmentId &&
        input.afterSpeaker !== undefined
      ) {
        // Req 2.10: 単一 Segment の話者ラベルを表示に反映
        setAppliedSpeaker((prev) => {
          const next = new Map(prev);
          next.set(input.segmentId, input.afterSpeaker!);
          return next;
        });
      } else if (
        input.correctionType === 'SPEAKER_RENAME' &&
        input.beforeSpeaker !== undefined &&
        input.afterSpeaker !== undefined
      ) {
        // Req 2.14: 話者ラベル一括変更を全 Segment の表示に反映
        setSpeakerRenames((prev) => [
          ...prev,
          { oldLabel: input.beforeSpeaker!, newLabel: input.afterSpeaker! },
        ]);
      }
      return true;
    },
    [apis, sessionId]
  );

  // 修正済みセグメントを修正前テキストに戻す（要件A）。
  // 戻し操作も Correction として記録（before=現在の修正後, after=元テキスト）した上で、
  // appliedText から該当 segmentId を delete する。これにより correctedSegmentIds /
  // displayCorrections から外れ、segments の originalText が base の元テキストに戻り未修正表示になる。
  const handleRevertCorrection = useCallback(
    async (segmentId: string): Promise<boolean> => {
      if (!sessionId) return false;
      const base = baseSegments.find((s) => s.segmentId === segmentId);
      if (!base) return false;
      const current = appliedText.get(segmentId);
      // 未修正、または既に元テキストと同じなら何もしない（冪等）
      if (current === undefined || current === base.originalText) {
        return true;
      }
      const result = await apis.correction.createCorrection(sessionId, {
        correctionId: generateCorrectionId(),
        segmentId,
        correctionType: 'TEXT',
        beforeText: current,
        afterText: base.originalText,
      });
      if (!result.ok) return false;
      setAppliedText((prev) => {
        const next = new Map(prev);
        next.delete(segmentId);
        return next;
      });
      return true;
    },
    [apis, sessionId, baseSegments, appliedText]
  );

  // 修正候補取得 (Req 8.x)
  const handleFetchSuggestions = useCallback(
    async (segmentId: string, originalText: string) => {
      if (!sessionId) return { suggestions: [], hasError: false };
      const result = await apis.suggestion.getSuggestions(sessionId, segmentId, originalText);
      if (!result.ok) {
        return { suggestions: [], hasError: true };
      }
      return {
        suggestions: result.value.suggestions,
        hasError: result.value.hasExternalApiError,
      };
    },
    [apis, sessionId]
  );

  // セッション名変更。成功時はヘッダ表示を更新する。
  const handleRenameSession = useCallback(
    async (name: string): Promise<AppError | null> => {
      if (!sessionId) return null;
      const result = await apis.session.renameSession(sessionId, name);
      if (result.ok) {
        setSessionName(result.value.data.name);
        return null;
      }
      return result.error;
    },
    [apis, sessionId]
  );

  // トランスクリプションからセッション名候補を取得する。
  const handleRequestNameSuggestion = useCallback(async () => {
    if (!sessionId) return null;
    const result = await apis.session.getSessionNameSuggestion(sessionId);
    return result.ok ? result.value : null;
  }, [apis, sessionId]);

  // 話者ラベルを追加する。成功時はマスタ一覧を更新して null を返し、失敗時はエラーメッセージを返す。
  const handleAddSpeakerLabel = useCallback(
    async (label: string): Promise<string | null> => {
      if (!sessionId) return 'セッションが特定できません。';
      const result = await apis.session.addSpeakerLabel(sessionId, label);
      if (result.ok) {
        setMasterSpeakerLabels(result.value.data.speakerLabels ?? []);
        return null;
      }
      return result.error.message;
    },
    [apis, sessionId]
  );

  // 話者ラベルを削除する。成功時はマスタ一覧を更新して null を返し、失敗時はエラーメッセージを返す。
  const handleDeleteSpeakerLabel = useCallback(
    async (label: string): Promise<string | null> => {
      if (!sessionId) return 'セッションが特定できません。';
      const result = await apis.session.deleteSpeakerLabel(sessionId, label);
      if (result.ok) {
        setMasterSpeakerLabels(result.value.data.speakerLabels ?? []);
        return null;
      }
      return result.error.message;
    },
    [apis, sessionId]
  );

  return (
    <ReviewPage
      segments={segments}
      mediaUrl={mediaUrl}
      mediaType={mediaType}
      isLoading={isLoading}
      error={error}
      sessionId={sessionId}
      sessionName={sessionName}
      sessionStatus={sessionStatus}
      mediaFileId={mediaFileId}
      mediaFileName={mediaFileName}
      userRole={userRole}
      transcriptionApi={apis.transcription}
      deletionApi={apis.deletion}
      onSaveCorrection={handleSaveCorrection}
      onFetchSuggestions={handleFetchSuggestions}
      onRevertCorrection={handleRevertCorrection}
      correctedSegmentIds={correctedSegmentIds}
      displayCorrections={displayCorrections}
      isMediaDeleted={isMediaDeleted}
      mediaUnavailableReason={mediaUnavailableReason}
      onMediaDeleted={() => setIsMediaDeleted(true)}
      onTranscriptionDeleted={() => navigate('/')}
      onRenameSession={handleRenameSession}
      onRequestNameSuggestion={handleRequestNameSuggestion}
      masterSpeakerLabels={masterSpeakerLabels}
      onAddSpeakerLabel={handleAddSpeakerLabel}
      onDeleteSpeakerLabel={handleDeleteSpeakerLabel}
    />
  );
}

/**
 * AdminPageWrapper - AdminPage をルーティングに接続するラッパー
 * ADMINロールのみアクセス可能。それ以外はホームにリダイレクト。
 */
function AdminPageWrapper({ user, getToken }: { user: AuthUser | null; getToken: () => Promise<string> }) {
  const adminApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new AdminApi(client);
  }, [getToken]);

  const sessionApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new SessionApi(client);
  }, [getToken]);

  const admin = useAdmin(adminApi, sessionApi);

  // Route guard: only ADMIN can access
  if (user && user.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }

  return (
    <AdminPage
      users={admin.users}
      teams={admin.teams}
      sessions={admin.sessions}
      teamMembers={admin.teamMembers}
      teamAssignments={admin.teamAssignments}
      ipAllowlistEntries={admin.ipAllowlistEntries}
      auditLogs={admin.auditLogs}
      auditLogTotalCount={admin.auditLogTotalCount}
      auditLogCurrentPage={admin.auditLogCurrentPage}
      isLoading={admin.isLoading}
      onCreateUser={admin.createUser}
      onDisableUser={admin.disableUser}
      onEnableUser={admin.enableUser}
      onEditUser={admin.editUser}
      currentUserId={user?.userId}
      onCreateTeam={admin.createTeam}
      onEditTeam={admin.editTeam}
      onDeleteTeam={admin.deleteTeam}
      onAddMember={admin.addMember}
      onRemoveMember={admin.removeMember}
      onAssignSession={admin.assignSession}
      onUnassignSession={admin.unassignSession}
      onAddIPEntry={admin.addIPEntry}
      onDeleteIPEntry={admin.deleteIPEntry}
      onAuditLogFilterChange={admin.onAuditLogFilterChange}
      onAuditLogPageChange={admin.onAuditLogPageChange}
      onDeleteAuditLogs={admin.deleteAuditLogs}
    />
  );
}

/**
 * RankingPageWrapper - RankingPage をルーティングに接続するラッパー
 * バックエンド GET /ranking を呼び出してデータを取得する
 */
function RankingPageWrapper({ getToken, userId }: { getToken: () => Promise<string>; userId: string }) {
  const [rankings, setRankings] = useState<Array<{ rank: number; userId: string; displayName: string; answerCount: number; accuracyRate: number; score: number }>>([]);
  const [currentUser, setCurrentUser] = useState<{ rank: number; userId: string; displayName: string; answerCount: number; accuracyRate: number; score: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<RankingPeriod>('ALL');
  const [pagination, setPagination] = useState<{ currentPage: number; pageSize: number; totalItems: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean } | undefined>();

  const rankingApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new RankingApi(client);
  }, [getToken]);

  const [prevPeriod, setPrevPeriod] = useState(selectedPeriod);

  const fetchRanking = useCallback(async (period: RankingPeriod, page?: number) => {
    const result = await rankingApi.getRanking({ period, page });
    if (result.ok) {
      setRankings(result.value.data.rankings);
      setCurrentUser(result.value.data.currentUser);
      setPagination(result.value.data.pagination);
      setError(null);
    } else {
      setError({ message: result.error.message });
    }
    setIsLoading(false);
  }, [rankingApi]);

  // 期間が変わったらローダーを表示（レンダー時に state を調整）。初回マウントは
  // isLoading が true 初期化済みのためスピナーが出る。
  if (prevPeriod !== selectedPeriod) {
    setPrevPeriod(selectedPeriod);
    setIsLoading(true);
  }

  useEffect(() => {
    void (async () => {
      await fetchRanking(selectedPeriod);
    })();
  }, [fetchRanking, selectedPeriod]);

  const handlePeriodChange = (period: RankingPeriod) => {
    setSelectedPeriod(period);
  };

  const handlePageChange = (page: number) => {
    setIsLoading(true);
    fetchRanking(selectedPeriod, page);
  };

  return (
    <RankingPage
      rankings={rankings}
      currentUser={currentUser}
      currentUserId={userId}
      isLoading={isLoading}
      error={error}
      selectedPeriod={selectedPeriod}
      onPeriodChange={handlePeriodChange}
      pagination={pagination}
      onPageChange={handlePageChange}
    />
  );
}

/**
 * describeConsensusResolveError - Consensus 解決エラーを校閲者向けの日本語に変換する。
 * CONFLICT 以外のセグメントや編集不可（COMPLETED 済み等）を明示する。
 */
function describeConsensusResolveError(error: AppError): string {
  const code = error.code;
  const status = error.statusCode;
  if (code === 'VALIDATION_ERROR' || status === 400) {
    return 'このセグメントは解決できません。競合解決待ちのセグメントのみ確定できます。';
  }
  if (code === 'FORBIDDEN' || status === 403) {
    return 'この操作を行う権限がありません。';
  }
  if (code === 'NOT_FOUND' || status === 404) {
    return '対象のセッションまたはセグメントが見つかりません。';
  }
  return error.message
    ? `Consensus の確定に失敗しました: ${error.message}`
    : 'Consensus の確定に失敗しました。';
}

/**
 * ConsensusPageWrapper - ConsensusPage をルーティングに接続するラッパー（ADMIN 専用）
 * バックエンド GET /consensus/{sessionId}/segments を呼び出してデータを取得し、
 * POST /consensus/{sessionId}/resolve で CONFLICT セグメントを手動解決する。
 */
function ConsensusPageWrapper({ user, getToken }: { user: AuthUser | null; getToken: () => Promise<string> }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [segments, setSegments] = useState<ConsensusSegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const consensusApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new ConsensusApi(client);
  }, [getToken]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    async function fetchSegments() {
      setIsLoading(true);
      const result = await consensusApi.getConsensusSegments(sessionId!);
      if (cancelled) return;
      if (result.ok) {
        setSegments(result.value.data);
        setError(null);
      } else {
        setError({ message: 'Consensus 状態の取得に失敗しました。' });
      }
      setIsLoading(false);
    }
    fetchSegments();
    return () => { cancelled = true; };
  }, [consensusApi, sessionId]);

  const handleResolve = useCallback(
    async (segmentId: string, selectedText: string): Promise<void> => {
      if (!sessionId) return;
      setResolveError(null);
      const result = await consensusApi.resolveConsensus(sessionId, { segmentId, selectedText });
      if (result.ok) {
        // 成功時: 該当セグメントをローカルで CONFIRMED に更新する。
        setSegments((prev) =>
          prev.map((s) =>
            s.segmentId === segmentId
              ? {
                  ...s,
                  consensusStatus: 'CONFIRMED',
                  consensusText: selectedText,
                  reviewerAnswers: undefined,
                }
              : s
          )
        );
      } else {
        setResolveError(describeConsensusResolveError(result.error));
      }
    },
    [consensusApi, sessionId]
  );

  // Route guard: only ADMIN can access
  if (user && user.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }

  return (
    <ConsensusPage
      sessionId={sessionId}
      segments={segments}
      isLoading={isLoading}
      error={error}
      resolveError={resolveError}
      onResolve={handleResolve}
    />
  );
}

/**
 * MediaUploadPageWrapper - MediaUploadPage をルーティングに接続するラッパー
 */
function MediaUploadPageWrapper({ getToken }: { getToken: () => Promise<string> }) {
  const navigate = useNavigate();

  const mediaApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new MediaApi(client);
  }, [getToken]);

  const transcriptionApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new TranscriptionApi(client);
  }, [getToken]);

  const languageModelApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new LanguageModelApi(client);
  }, [getToken]);

  const deletionApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new DeletionApi(client);
  }, [getToken]);

  // 親でメディアファイル一覧を取得し、一覧表示（MediaFileList）と
  // 文字起こしジョブ作成フォーム（TranscriptionJobForm）の両方に配る。
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // アップロード完了・ジョブ開始のたびにインクリメントして一覧を再取得する
  const [refreshKey, setRefreshKey] = useState(0);

  // 実行中のポーリングタイマーを保持し、アンマウント時にクリアする
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchMediaFiles() {
      setIsLoadingMedia(true);
      setMediaError(null);
      const result = await mediaApi.listMediaFiles();
      if (cancelled) return;
      if (result.ok) {
        setMediaFiles(result.value.data.mediaFiles);
      } else {
        setMediaError(result.error.message);
      }
      setIsLoadingMedia(false);
    }
    fetchMediaFiles();
    return () => {
      cancelled = true;
    };
  }, [mediaApi, refreshKey]);

  // アンマウント時にポーリングタイマーを確実に停止する
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const handleUploadComplete = useCallback(
    (mediaFileId: string) => {
      // まず即時に一覧を再取得
      setRefreshKey((k) => k + 1);

      // S3イベント経由で process-upload が DynamoDB にレコードを書くまでにラグがあるため、
      // アップロードしたファイルが一覧に現れるまで数秒間隔で自動リトライする。
      const MAX_ATTEMPTS = 5;
      const INTERVAL_MS = 3000;

      // 既存のポーリングがあれば止めてから新規開始
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      let attempts = 0;

      const poll = async () => {
        attempts += 1;
        const result = await mediaApi.listMediaFiles();

        if (result.ok) {
          const files = result.value.data.mediaFiles;
          setMediaFiles(files);
          setMediaError(null);

          // 目的のファイルが一覧に現れたら停止
          const found = files.some((f) => f.mediaFileId === mediaFileId);
          if (found) {
            pollTimerRef.current = null;
            return;
          }
        }

        // 上限に達していなければ次のリトライを予約
        if (attempts < MAX_ATTEMPTS) {
          pollTimerRef.current = setTimeout(poll, INTERVAL_MS);
        } else {
          pollTimerRef.current = null;
        }
      };

      pollTimerRef.current = setTimeout(poll, INTERVAL_MS);
    },
    [mediaApi]
  );

  const handleJobStarted = useCallback(() => {
    // ジョブ開始後はセッションが（完了後に）作られるため、セッション一覧へ誘導
    navigate('/');
  }, [navigate]);

  const handleDeleted = useCallback(() => {
    // 削除後に一覧を再取得
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="p-4 space-y-8">
      <MediaUploadPage mediaApi={mediaApi} onUploadComplete={handleUploadComplete} />

      <div className="max-w-2xl mx-auto w-full space-y-8">
        <section aria-label="文字起こしジョブ作成セクション">
          <TranscriptionJobForm
            transcriptionApi={transcriptionApi}
            languageModelApi={languageModelApi}
            mediaFiles={mediaFiles}
            onJobStarted={handleJobStarted}
          />
        </section>

        <section aria-label="メディアファイル一覧セクション">
          <MediaFileList
            mediaApi={mediaApi}
            mediaFiles={mediaFiles}
            isLoading={isLoadingMedia}
            error={mediaError}
            deletionApi={deletionApi}
            onDeleted={handleDeleted}
          />
        </section>
      </div>
    </div>
  );
}

/**
 * ProfilePageWrapper - ProfilePage をルーティングに接続するラッパー
 * ログイン中ユーザーが自身の表示名・メールアドレスを編集する（PATCH /me）
 */
function ProfilePageWrapper({
  user,
  getToken,
  onRefresh,
}: {
  user: AuthUser | null;
  getToken: () => Promise<string>;
  onRefresh: () => Promise<void>;
}) {
  const profileApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new ProfileApi(client);
  }, [getToken]);

  const handleSave = useCallback(
    async (data: { displayName?: string; email?: string }): Promise<AppError | null> => {
      const result = await profileApi.updateProfile(data);
      if (result.ok) {
        // Refresh the auth context so the navigation display name updates.
        await onRefresh();
        return null;
      }
      return result.error;
    },
    [profileApi, onRefresh]
  );

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <ProfilePage
      displayName={user.displayName}
      email={user.email}
      onSave={handleSave}
    />
  );
}

/**
 * LanguageModelPageWrapper - LanguageModelPage をルーティングに接続するラッパー
 * Admin/TeamLeader のみアクセス可能
 */
function LanguageModelPageWrapper({ userRole, getToken }: { userRole: UserRole; getToken: () => Promise<string> }) {
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  const languageModelApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new LanguageModelApi(client);
  }, [getToken]);

  const sessionApi = useMemo(() => {
    const client = new ApiClient({ baseUrl: getApiBaseUrl(), getToken });
    return new SessionApi(client);
  }, [getToken]);

  const languageModelsHook = useLanguageModels(languageModelApi);

  useEffect(() => {
    let cancelled = false;
    async function fetchSessions() {
      setIsLoadingSessions(true);
      const result = await sessionApi.listSessions({ status: 'COMPLETED' });
      if (!cancelled && result.ok) {
        setSessions(result.value.items);
      }
      if (!cancelled) setIsLoadingSessions(false);
    }
    fetchSessions();
    return () => { cancelled = true; };
  }, [sessionApi]);

  return (
    <LanguageModelPage
      languageModelApi={languageModelApi}
      useLanguageModelsHook={languageModelsHook}
      sessions={sessions}
      userRole={userRole}
      isLoadingSessions={isLoadingSessions}
    />
  );
}

/**
 * AppRoutes - React Router によるページ遷移定義
 *
 * - `/` → SessionListPage
 * - `/sessions/:sessionId` → ReviewPage
 * - `/upload` → MediaUploadPage
 * - `/language-models` → LanguageModelPage (Admin/TeamLeader only)
 * - `/admin` → AdminPage
 * - `/ranking` → RankingPage
 *
 * Requirements: 1.1, 2.1, 5.4, 6.1, 7.1, 9.9
 */
function AppRoutes() {
  const auth = useAuth();

  const handleLogout = useCallback(async () => {
    try {
      await auth.signOut();
    } finally {
      // Return to the login screen after clearing the session.
      window.location.reload();
    }
  }, [auth]);

  // Network status banner (display-only). Shown on every authenticated page.
  const online = useOnlineStatus();

  // Idle session timeout. On full timeout, reuse the existing sign-out path
  // (same as Navigation's "ログアウト"); "続行" resets the idle timer.
  const { showWarning, remainingMs, reset } = useIdleTimeout({ onTimeout: handleLogout });

  const navProps = {
    userRole: auth.user?.role,
    displayName: auth.user?.displayName,
    onLogout: handleLogout,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <OfflineBanner isOffline={!online} />
      <SessionTimeoutWarning visible={showWarning} remainingMs={remainingMs} onContinue={reset} />
      <Routes>
        <Route
          path="/"
          element={
            <>
              <Navigation {...navProps} />
              <SessionListPageWrapper
                getToken={auth.getToken}
                userRole={auth.user?.role}
                userId={auth.user?.userId}
              />
            </>
          }
        />
        <Route
          path="/assigned"
          element={
            <>
              <Navigation {...navProps} />
              <SessionListPageWrapper
                getToken={auth.getToken}
                userRole={auth.user?.role}
                userId={auth.user?.userId}
                scope="assigned"
                title="自分の割り当てセッション"
              />
            </>
          }
        />
        <Route
          path="/joinable"
          element={
            <>
              <Navigation {...navProps} />
              <SessionListPageWrapper
                getToken={auth.getToken}
                userRole={auth.user?.role}
                userId={auth.user?.userId}
                scope="joinable"
                title="参加可能なセッション"
              />
            </>
          }
        />
        <Route
          path="/sessions/:sessionId"
          element={
            // 校閲画面はビューポート高で固定し、Navigation を上部固定、
            // ReviewPage 本体を残り領域（flex-1 min-h-0）に収める。
            // これにより ReviewPage 内の h-full / overflow 制御が機能し、
            // メディア再生エリアがページ全体スクロールで流れて消えるのを防ぐ。
            <div className="h-screen flex flex-col overflow-hidden">
              <div className="flex-shrink-0">
                <Navigation {...navProps} />
              </div>
              <div className="flex-1 min-h-0">
                <ReviewPageWrapper getToken={auth.getToken} userRole={auth.user?.role} />
              </div>
            </div>
          }
        />
        <Route
          path="/upload"
          element={
            <>
              <Navigation {...navProps} />
              <MediaUploadPageWrapper getToken={auth.getToken} />
            </>
          }
        />
        <Route
          path="/language-models"
          element={
            <>
              <Navigation {...navProps} />
              <LanguageModelPageWrapper userRole={auth.user?.role ?? 'REVIEWER'} getToken={auth.getToken} />
            </>
          }
        />
        <Route
          path="/admin"
          element={
            <>
              <Navigation {...navProps} />
              <AdminPageWrapper user={auth.user} getToken={auth.getToken} />
            </>
          }
        />
        <Route
          path="/ranking"
          element={
            <>
              <Navigation {...navProps} />
              <RankingPageWrapper getToken={auth.getToken} userId={auth.user?.userId ?? ''} />
            </>
          }
        />
        <Route
          path="/consensus/:sessionId"
          element={
            <>
              <Navigation {...navProps} />
              <ConsensusPageWrapper user={auth.user} getToken={auth.getToken} />
            </>
          }
        />
        <Route
          path="/profile"
          element={
            <>
              <Navigation {...navProps} />
              <ProfilePageWrapper
                user={auth.user}
                getToken={auth.getToken}
                onRefresh={auth.refreshUser}
              />
            </>
          }
        />
      </Routes>
    </div>
  );
}

/**
 * getBasePath - 環境変数から BasePath を取得
 * Vite の import.meta.env.BASE_URL を使用（vite.config.ts の base 設定に連動）
 */
function getBasePath(): string {
  const base = import.meta.env.BASE_URL || '/';
  // Remove trailing slash for basename (React Router expects no trailing slash)
  return base.endsWith('/') && base.length > 1 ? base.slice(0, -1) : base;
}

function App() {
  const basePath = getBasePath();

  return (
    <ErrorBoundary>
      <BrowserRouter basename={basePath}>
        <AuthGate />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

/**
 * AuthGate - 認証状態に応じてログインフォームまたはアプリ画面を表示
 *
 * カスタム LoginForm を使用して SRP 認証を行う。
 * Cognito Hosted UI へのリダイレクトは行わない。
 */
function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();
  const [authCompleted, setAuthCompleted] = useState(false);

  // LoginForm で認証成功時に呼ばれるコールバック
  const handleAuthenticated = useCallback(() => {
    setAuthCompleted(true);
    // useAuth の Hub listener が signedIn イベントを受信して状態を更新する
    window.location.reload();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">認証を確認しています...</p>
      </div>
    );
  }

  if (!isAuthenticated && !authCompleted) {
    return <LoginForm onAuthenticated={handleAuthenticated} />;
  }

  return <AppRoutes />;
}

export default App;
