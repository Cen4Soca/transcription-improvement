import { useState, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MediaPlayer } from '../components/MediaPlayer';
import { SessionNameEditor } from '../components/SessionNameEditor';
import { TranscriptionEditor } from '../components/TranscriptionEditor';
import { TranscriptionDownload } from '../components/TranscriptionDownload';
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog';
import { SearchBar, type SearchBarHandle } from '../components/SearchBar';
import { SpeakerLabelManager, type SpeakerRenameResult } from '../components/SpeakerLabelManager';
import { useMediaSync } from '../hooks/useMediaSync';
import { useAuth } from '../hooks/useAuth';
import { useInlineEdit } from '../hooks/useInlineEdit';
import { useSearch } from '../hooks/useSearch';
import { useUndoManager } from '../hooks/useUndoManager';
import { useSuggestionPopup, type SuggestionCandidate } from '../hooks/useSuggestionPopup';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { sortSegmentsByTimestamp } from '../utils/segments';
import type { Segment } from '../types/segment';
import type { TranscriptionApi } from '../services/transcription-api';
import type { DeletionApi } from '../services/deletion-api';
import type { CreateCorrectionInput } from '../services/correction-api';
import type { UserRole } from '../types/user';
import type { AppError } from '../types/api';
import type { ReviewSessionStatus } from '../types/session';

export type LayoutMode = 'horizontal' | 'vertical';

/** 校閲画面が Correction を保存するためのコールバック引数 */
export type SaveCorrection = (input: CreateCorrectionInput) => Promise<boolean>;

/** 修正候補を取得するためのコールバック */
export type FetchSuggestions = (
  segmentId: string,
  originalText: string
) => Promise<{ suggestions: SuggestionCandidate[]; hasError: boolean }>;

export interface ReviewPageProps {
  segments: Segment[];
  mediaUrl: string | null;
  mediaType?: 'audio' | 'video';
  error?: { message: string } | null;
  isLoading?: boolean;
  sessionId?: string;
  sessionName?: string;
  /** セッションのステータス。COMPLETED のとき校閲画面を読み取り専用にする */
  sessionStatus?: ReviewSessionStatus;
  mediaFileId?: string;
  mediaFileName?: string;
  userRole?: UserRole;
  transcriptionApi?: TranscriptionApi;
  deletionApi?: DeletionApi;
  /** Correction 保存コールバック（保存成功で true） */
  onSaveCorrection?: SaveCorrection;
  /** 修正候補取得コールバック */
  onFetchSuggestions?: FetchSuggestions;
  /** 修正済みセグメントを修正前テキストに戻すコールバック（成功で true, 要件A） */
  onRevertCorrection?: (segmentId: string) => Promise<boolean>;
  /** すでに修正済みの segmentId 集合（未修正フィルタ・復元表示用） */
  correctedSegmentIds?: Set<string>;
  /** 修正済みセグメントの修正前/修正後テキスト（並列表示用, Req 1, 2） */
  displayCorrections?: Map<string, { originalText: string; correctedText: string }>;
  isMediaDeleted?: boolean;
  /** メディアURL取得に失敗した理由（403/404 など）。設定時はユーザー向けに表示する */
  mediaUnavailableReason?: string | null;
  onMediaDeleted?: () => void;
  onTranscriptionDeleted?: () => void;
  /** セッション名の変更コールバック（成功で null, 失敗で AppError）。指定時のみ編集 UI を表示する */
  onRenameSession?: (name: string) => Promise<AppError | null>;
  /** トランスクリプションからセッション名候補を取得するコールバック */
  onRequestNameSuggestion?: () => Promise<{
    suggestion: string | null;
    hasExternalApiError: boolean;
  } | null>;
  /** 話者ラベルのマスタ一覧（Segment 由来ラベルと和集合で表示） */
  masterSpeakerLabels?: string[];
  /** 話者ラベルを追加するコールバック（成功で null, 失敗で日本語エラーメッセージ） */
  onAddSpeakerLabel?: (label: string) => Promise<string | null>;
  /** 話者ラベルを削除するコールバック（成功で null, 失敗で日本語エラーメッセージ） */
  onDeleteSpeakerLabel?: (label: string) => Promise<string | null>;
}

function canDelete(role: UserRole | undefined): boolean {
  return role === 'ADMIN' || role === 'TEAM_LEADER';
}

/** correctionId を生成する（crypto.randomUUID が使えない環境向けフォールバック付き） */
function generateCorrectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * ReviewPage - 校閲画面
 *
 * MediaPlayer と TranscriptionEditor を並べて表示し、再生位置と Segment ハイライトを同期する。
 * インライン編集・修正候補・検索・話者ラベル編集・アンドゥ・キーボードショートカット・
 * ダウンロード・削除を統合した校閲作業の中核画面。
 *
 * 完了（COMPLETED）セッションでは校閲画面を読み取り専用にし、インライン編集・
 * 話者ラベル管理・修正候補・修正前に戻す操作を無効化する（ダウンロードは引き続き可能）。
 *
 * Requirements: 1.4, 2.1-2.11, 2.18, 2.19, 3.1-3.8, 4.1, 4.2, 4.3, 4.5, 4.6, 4.9, 5.8,
 *   6.1-6.6, 7.3, 7.5, 7.10, 8.1-8.10, 11.1
 */
export function ReviewPage({
  segments,
  mediaUrl,
  mediaType,
  error,
  isLoading = false,
  sessionId,
  sessionName,
  sessionStatus,
  mediaFileId,
  mediaFileName,
  userRole,
  transcriptionApi,
  deletionApi,
  onSaveCorrection,
  onFetchSuggestions,
  onRevertCorrection,
  correctedSegmentIds,
  displayCorrections,
  isMediaDeleted = false,
  mediaUnavailableReason,
  onMediaDeleted,
  onTranscriptionDeleted,
  onRenameSession,
  onRequestNameSuggestion,
  masterSpeakerLabels,
  onAddSpeakerLabel,
  onDeleteSpeakerLabel,
}: ReviewPageProps) {
  const [layout, setLayout] = useState<LayoutMode>('horizontal');
  const [mediaError, setMediaError] = useState<string | null>(null);
  // ローカル削除の一方向ラッチ。isMediaDeleted prop は詳細取得後に非同期で true に
  // なり得るため、prop とローカル削除フラグの論理和を派生値として算出する。
  const [locallyDeleted, setLocallyDeleted] = useState(false);
  const mediaDeleted = isMediaDeleted || locallyDeleted;
  const [deleteMediaDialogOpen, setDeleteMediaDialogOpen] = useState(false);
  const [deleteTranscriptionDialogOpen, setDeleteTranscriptionDialogOpen] = useState(false);
  const [speakerManagerOpen, setSpeakerManagerOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Req 8.10: 修正候補のホバー自動表示を無効化し、専用ボタンのみで表示するモード。
  // デフォルトで有効（チェック済み）とし、ボタンを押したときだけ候補を表示する。
  const [disableHoverSuggestion, setDisableHoverSuggestion] = useState(true);
  // 現在の検索一致位置（SearchBar のナビゲーション用）
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [prevSearchKey, setPrevSearchKey] = useState('');

  // Use userRole prop if provided, otherwise try to get from useAuth
  const { user: authUser } = useAuth();
  const resolvedRole = userRole ?? authUser?.role;

  // --- 編集状態管理 (Req 2.x) ---
  const inlineEdit = useInlineEdit();
  const editTexts = useMemo(() => {
    const map = new Map<string, string>();
    inlineEdit.editingEntries.forEach((entry, segmentId) => {
      map.set(segmentId, entry.editText);
    });
    return map;
  }, [inlineEdit.editingEntries]);

  // --- アンドゥ (Req 3.8) ---
  const undo = useUndoManager();

  // --- 検索 (Req 6.x) ---
  const correctedIds = useMemo(
    () => correctedSegmentIds ?? new Set<string>(),
    [correctedSegmentIds]
  );
  const search = useSearch(segments, correctedIds);

  const editingActive = inlineEdit.editingCount > 0;

  const {
    highlightedSegmentId,
    handleTimeUpdate,
    handleSegmentClick,
    seekTo,
  } = useMediaSync(segments, { isEditing: editingActive });

  // --- Correction 保存の共通処理 ---
  const saveCorrection = useCallback(
    async (input: CreateCorrectionInput): Promise<boolean> => {
      if (!onSaveCorrection) return false;
      setSaveError(null);
      try {
        const ok = await onSaveCorrection(input);
        if (!ok) {
          setSaveError('修正内容の保存に失敗しました。もう一度お試しください。');
        }
        return ok;
      } catch {
        setSaveError('修正内容の保存に失敗しました。もう一度お試しください。');
        return false;
      }
    },
    [onSaveCorrection]
  );

  // --- テキスト編集確定 (Req 2.3, 3.1) ---
  const handleConfirmEdit = useCallback(
    async (segmentId: string, newText: string) => {
      const segment = segments.find((s) => s.segmentId === segmentId);
      const beforeText = segment?.originalText ?? '';
      // テキストが変化していなくても確定操作は Correction として記録し、
      // 対象 Segment を「修正済」ステータスに変更する（correctedSegmentIds に含める）。
      const isUnchanged = beforeText === newText;
      const correctionId = generateCorrectionId();
      const ok = await saveCorrection({
        correctionId,
        segmentId,
        correctionType: 'TEXT',
        beforeText,
        afterText: newText,
      });
      // 実際にテキストが変化した場合のみ undo スタックに積む
      // （変更なしの確定はアンドゥで戻す対象を持たない）。
      if (ok && !isUnchanged) {
        undo.push({ segmentId, beforeText, afterText: newText, correctionId });
      }
      inlineEdit.cancelEdit(segmentId);
    },
    [segments, saveCorrection, undo, inlineEdit]
  );

  // --- 修正候補ポップアップ (Req 8.x) ---
  const fetchSuggestions = useCallback(
    async (segmentId: string) => {
      if (!onFetchSuggestions) {
        return { suggestions: [], hasError: false };
      }
      const segment = segments.find((s) => s.segmentId === segmentId);
      return onFetchSuggestions(segmentId, segment?.originalText ?? '');
    },
    [onFetchSuggestions, segments]
  );

  const handleSuggestionSelect = useCallback(
    async (segmentId: string, text: string) => {
      const segment = segments.find((s) => s.segmentId === segmentId);
      const beforeText = segment?.originalText ?? '';
      if (beforeText === text) return;
      const correctionId = generateCorrectionId();
      const ok = await saveCorrection({
        correctionId,
        segmentId,
        correctionType: 'TEXT',
        beforeText,
        afterText: text,
      });
      if (ok) {
        undo.push({ segmentId, beforeText, afterText: text, correctionId });
      }
    },
    [segments, saveCorrection, undo]
  );

  // --- 修正前に戻す (要件A) ---
  // revert は undo スタックに積まない（handleUndo との二重戻しを防ぐ）。
  const handleRevert = useCallback(
    async (segmentId: string) => {
      if (!onRevertCorrection) return;
      setSaveError(null);
      try {
        const ok = await onRevertCorrection(segmentId);
        if (!ok) {
          setSaveError('修正内容の保存に失敗しました。もう一度お試しください。');
        }
      } catch {
        setSaveError('修正内容の保存に失敗しました。もう一度お試しください。');
      }
    },
    [onRevertCorrection]
  );

  const suggestionPopup = useSuggestionPopup({
    disableHoverAutoShow: disableHoverSuggestion,
    fetchSuggestions,
    onSelect: handleSuggestionSelect,
    onEditMode: (segmentId) => {
      const segment = segments.find((s) => s.segmentId === segmentId);
      inlineEdit.startEdit(segmentId, segment?.originalText ?? '');
    },
  });

  // --- 話者ラベル変更（単一Segment, Req 2.10） ---
  const handleSpeakerChange = useCallback(
    async (segmentId: string, beforeSpeaker: string, afterSpeaker: string) => {
      const correctionId = generateCorrectionId();
      await saveCorrection({
        correctionId,
        segmentId,
        correctionType: 'SPEAKER',
        beforeText: '',
        afterText: '',
        beforeSpeaker,
        afterSpeaker,
      });
    },
    [saveCorrection]
  );

  // --- 話者ラベル一括変更 (Req 2.14, 2.15) ---
  const handleSpeakerRename = useCallback(
    async (_updatedSegments: Segment[], result: SpeakerRenameResult) => {
      const correctionId = generateCorrectionId();
      await saveCorrection({
        correctionId,
        segmentId: '',
        correctionType: 'SPEAKER_RENAME',
        beforeText: '',
        afterText: '',
        beforeSpeaker: result.oldLabel,
        afterSpeaker: result.newLabel,
        affectedSegmentCount: result.affectedSegmentCount,
      });
      setSpeakerManagerOpen(false);
    },
    [saveCorrection]
  );

  // --- 検索ナビゲーション (Req 6.3) ---
  const sortedResults = useMemo(
    () => sortSegmentsByTimestamp(search.results),
    [search.results]
  );

  // キーワードや一致件数が変わったら現在位置をリセット（レンダー時に state を調整）
  const searchKey = `${search.keyword}|${sortedResults.length}`;
  if (prevSearchKey !== searchKey) {
    setPrevSearchKey(searchKey);
    setCurrentMatchIndex(search.keyword ? (sortedResults.length > 0 ? 0 : -1) : -1);
  }

  const gotoMatch = useCallback(
    (index: number) => {
      if (sortedResults.length === 0) return;
      const target = sortedResults[index];
      if (target) {
        handleSegmentClick(target.segmentId);
        const el = document.querySelector(`[data-segment-id="${target.segmentId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [sortedResults, handleSegmentClick]
  );

  const handleSearchNext = useCallback(() => {
    if (sortedResults.length === 0) return;
    const next = (currentMatchIndex + 1) % sortedResults.length;
    setCurrentMatchIndex(next);
    gotoMatch(next);
  }, [currentMatchIndex, sortedResults.length, gotoMatch]);

  const handleSearchPrevious = useCallback(() => {
    if (sortedResults.length === 0) return;
    const prev = (currentMatchIndex - 1 + sortedResults.length) % sortedResults.length;
    setCurrentMatchIndex(prev);
    gotoMatch(prev);
  }, [currentMatchIndex, sortedResults.length, gotoMatch]);

  const handleSearchClear = useCallback(() => {
    search.setKeyword('');
    setCurrentMatchIndex(-1);
  }, [search]);

  // --- アンドゥ実行 (Req 3.8) ---
  const handleUndo = useCallback(async () => {
    const entry = undo.undo();
    if (!entry) return;
    // 元のテキストに戻す Correction を新たに記録する
    const correctionId = generateCorrectionId();
    await saveCorrection({
      correctionId,
      segmentId: entry.segmentId,
      correctionType: 'TEXT',
      beforeText: entry.afterText,
      afterText: entry.beforeText,
    });
  }, [undo, saveCorrection]);

  // --- キーボードショートカット (Req 11.1) ---
  const searchBarRef = useRef<SearchBarHandle>(null);
  useKeyboardShortcuts({
    onUndo: handleUndo,
    onFocusSearch: () => searchBarRef.current?.focus(),
    enabled: true,
  });

  const toggleLayout = useCallback(() => {
    setLayout((prev) => (prev === 'horizontal' ? 'vertical' : 'horizontal'));
  }, []);

  const handleMediaError = useCallback((errorMsg: string) => {
    setMediaError(errorMsg);
  }, []);

  const handleDeleteMedia = useCallback(async () => {
    if (!deletionApi || !mediaFileId) return;
    const result = await deletionApi.deleteMediaFile(mediaFileId);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    setLocallyDeleted(true);
    setDeleteMediaDialogOpen(false);
    onMediaDeleted?.();
  }, [deletionApi, mediaFileId, onMediaDeleted]);

  const handleDeleteTranscription = useCallback(async () => {
    if (!deletionApi || !sessionId) return;
    const result = await deletionApi.deleteTranscription(sessionId);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    setDeleteTranscriptionDialogOpen(false);
    onTranscriptionDeleted?.();
  }, [deletionApi, sessionId, onTranscriptionDeleted]);

  // ローカルの再生エラー（MediaPlayer onError）と、URL取得失敗理由（403/404 等）を統合する。
  // mediaUnavailableReason は mediaUrl が null でも表示できるよう独立して評価する。
  const effectiveMediaError = mediaError ?? mediaUnavailableReason ?? null;
  const showMediaPlayer = mediaUrl !== null && effectiveMediaError === null && !mediaDeleted;
  const showDeleteButtons = canDelete(resolvedRole);
  // 完了セッションは確定済みのため読み取り専用（Req 2.18, 2.19）
  const isReadOnly = sessionStatus === 'COMPLETED';
  // 編集・候補・保存が有効なのは保存コールバックが提供されており、かつ読み取り専用でない場合のみ
  const editingEnabled = Boolean(onSaveCorrection) && !isReadOnly;
  const suggestionEnabled = Boolean(onFetchSuggestions) && !isReadOnly;
  // 話者ラベルが Segment にある、またはマスタが非空なら話者管理を提供 (Req 2.13)
  const hasSpeakerLabels = useMemo(
    () =>
      segments.some((s) => Boolean(s.speakerLabel)) ||
      (masterSpeakerLabels?.length ?? 0) > 0,
    [segments, masterSpeakerLabels]
  );

  // 検索・フィルタ適用後に表示する Segment。キーワードもフィルタも無ければ全件。
  const displayedSegments =
    search.keyword || search.showUncorrectedOnly ? search.results : segments;

  return (
    <div className="flex flex-col h-full" role="main" aria-label="校閲画面">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">校閲</h1>
          {sessionName &&
            (onRenameSession ? (
              <SessionNameEditor
                name={sessionName}
                onSave={onRenameSession}
                onRequestSuggestion={onRequestNameSuggestion}
              />
            ) : (
              <span className="font-medium text-gray-700 truncate">
                {sessionName}
              </span>
            ))}
          {/* ADMIN 限定: Consensus 状態確認への導線 (バグ1, Req 2.1) */}
          {resolvedRole === 'ADMIN' && sessionId && (
            <Link
              to={`/consensus/${sessionId}`}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors whitespace-nowrap"
              aria-label="Consensus を確認"
            >
              Consensus を確認
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 修正候補のホバー自動表示 無効化トグル (Req 8.10) */}
          {suggestionEnabled && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none mr-1">
              <input
                type="checkbox"
                checked={disableHoverSuggestion}
                onChange={(e) => setDisableHoverSuggestion(e.target.checked)}
                aria-label="ボタンを押して候補を表示"
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-600 whitespace-nowrap">
                ボタンを押して候補を表示
              </span>
            </label>
          )}

          {/* 話者ラベル管理 (Req 2.13) */}
          {editingEnabled && hasSpeakerLabels && (
            <button
              type="button"
              onClick={() => setSpeakerManagerOpen((v) => !v)}
              aria-label="話者ラベル管理を開く"
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
            >
              話者ラベル管理
            </button>
          )}

          {/* Delete buttons for Admin/TeamLeader */}
          {showDeleteButtons && deletionApi && (
            <>
              {mediaFileId && !mediaDeleted && (
                <button
                  type="button"
                  onClick={() => setDeleteMediaDialogOpen(true)}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
                  aria-label="メディアファイルを削除"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-4 h-4 mr-1"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  メディア削除
                </button>
              )}
              {sessionId && (
                <button
                  type="button"
                  onClick={() => setDeleteTranscriptionDialogOpen(true)}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
                  aria-label="Transcription を削除"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-4 h-4 mr-1"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Transcription 削除
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={toggleLayout}
            aria-label={
              layout === 'horizontal'
                ? 'レイアウトを上下分割に切り替え'
                : 'レイアウトを左右分割に切り替え'
            }
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            {layout === 'horizontal' ? (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" />
                </svg>
                <span>上下分割</span>
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M10 2a.75.75 0 0 1 .75.75v14.5a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 10 2Z" />
                </svg>
                <span>左右分割</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 検索バー (Req 6.x) */}
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
        <SearchBar
          onSearch={search.setKeyword}
          onNext={handleSearchNext}
          onPrevious={handleSearchPrevious}
          onClear={handleSearchClear}
          onToggleUncorrectedOnly={search.setShowUncorrectedOnly}
          matchCount={search.matchCount}
          currentIndex={currentMatchIndex}
          ref={searchBarRef}
        />
      </div>

      {/* 完了セッションの読み取り専用通知 (Req 2.18, 2.19) */}
      {isReadOnly && (
        <div
          role="status"
          className="px-4 py-2 bg-blue-50 border-b border-blue-200 text-sm text-blue-700"
        >
          完了したセッションのため編集できません。
        </div>
      )}

      {/* 話者ラベル管理パネル (Req 2.13) */}
      {speakerManagerOpen && !isReadOnly && (
        <div className="px-4 py-2 border-b border-gray-200 bg-white">
          <SpeakerLabelManager
            segments={segments}
            masterLabels={masterSpeakerLabels}
            isOpen={speakerManagerOpen}
            onClose={() => setSpeakerManagerOpen(false)}
            onRenameConfirm={handleSpeakerRename}
            onAddLabel={onAddSpeakerLabel}
            onDeleteLabel={onDeleteSpeakerLabel}
          />
        </div>
      )}

      {/* 保存エラー (Req 3.7) */}
      {saveError && (
        <div
          role="alert"
          className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700"
        >
          {saveError}
        </div>
      )}

      {/* Media deleted notice */}
      {mediaDeleted && (
        <div
          role="status"
          className="px-4 py-2 bg-gray-100 border-b border-gray-200 text-sm text-gray-600"
        >
          メディアファイルは削除されました。再生機能は利用できません。
        </div>
      )}

      {/* Media error message */}
      {effectiveMediaError && !mediaDeleted && (
        <div
          role="alert"
          className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-700"
        >
          {effectiveMediaError}
        </div>
      )}

      {/* Main content area */}
      <div
        className={`flex-1 overflow-hidden ${
          layout === 'horizontal' ? 'flex flex-row' : 'flex flex-col'
        }`}
      >
        {/* MediaPlayer panel
            スクロール位置に関わらず再生エリアを常に画面上へ表示する。
            - horizontal: パネル内を overflow-auto のままにしつつ、中身を sticky top-0 で上部固定
            - vertical: パネル自体を sticky top-0 でビューポート上部に固定 */}
        {showMediaPlayer && (
          <div
            className={`${
              layout === 'horizontal'
                ? 'w-1/2 border-r border-gray-200 overflow-auto'
                : 'h-auto border-b border-gray-200 sticky top-0 z-10 bg-white'
            } p-4`}
            aria-label="メディアパネル"
          >
            <div
              className={layout === 'horizontal' ? 'sticky top-0' : undefined}
            >
              <MediaPlayer
                mediaUrl={mediaUrl}
                mediaType={mediaType}
                onTimeUpdate={handleTimeUpdate}
                onError={handleMediaError}
                seekTo={seekTo}
              />
            </div>
          </div>
        )}

        {/* TranscriptionEditor panel */}
        <div
          className={`${
            showMediaPlayer
              ? layout === 'horizontal'
                ? 'w-1/2'
                : 'flex-1'
              : 'w-full'
          } overflow-hidden flex flex-col`}
          data-scroll-container
          aria-label="文字起こしパネル"
        >
          <div className="flex-1 overflow-auto relative">
            <TranscriptionEditor
              segments={displayedSegments}
              error={error}
              isLoading={isLoading}
              highlightedSegmentId={highlightedSegmentId}
              searchQuery={search.keyword}
              displayCorrections={displayCorrections}
              correctedSegmentIds={correctedIds}
              editTexts={editTexts}
              onStartEdit={editingEnabled ? inlineEdit.startEdit : undefined}
              onUpdateText={editingEnabled ? inlineEdit.updateEditText : undefined}
              onConfirmEdit={editingEnabled ? handleConfirmEdit : undefined}
              onCancelEdit={editingEnabled ? inlineEdit.cancelEdit : undefined}
              onSegmentClick={handleSegmentClick}
              onSuggestionRequest={
                suggestionEnabled
                  ? (segmentId) => suggestionPopup.handleButtonClick(segmentId)
                  : undefined
              }
              onRevert={!isReadOnly && onRevertCorrection ? handleRevert : undefined}
              onSpeakerChange={editingEnabled ? handleSpeakerChange : undefined}
              onSegmentHoverStart={
                suggestionEnabled
                  ? (segmentId) => suggestionPopup.handleSegmentHoverStart(segmentId)
                  : undefined
              }
              onSegmentHoverEnd={
                suggestionEnabled ? suggestionPopup.handleSegmentHoverEnd : undefined
              }
              suggestion={
                suggestionEnabled
                  ? {
                      isVisible: suggestionPopup.state.isVisible,
                      segmentId: suggestionPopup.state.segmentId,
                      suggestions: suggestionPopup.state.suggestions,
                      isLoading: suggestionPopup.state.isLoading,
                      hasError: suggestionPopup.state.hasError,
                      onSelect: suggestionPopup.handleSelect,
                      onClose: suggestionPopup.closePopup,
                      onEditMode: suggestionPopup.handleEditMode,
                    }
                  : undefined
              }
            />
          </div>

          {/* TranscriptionDownload section */}
          {transcriptionApi && sessionId && sessionName && (
            <div className="border-t border-gray-200 p-4 bg-white">
              <TranscriptionDownload
                transcriptionApi={transcriptionApi}
                sessionId={sessionId}
                sessionName={sessionName}
              />
            </div>
          )}
        </div>
      </div>

      {/* Delete Media Confirm Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteMediaDialogOpen}
        title="メディアファイルの削除"
        resourceName={mediaFileName || 'メディアファイル'}
        warningMessage="この操作は取り消せません。メディアファイルが削除されると、再生機能が利用できなくなります。"
        onConfirm={handleDeleteMedia}
        onCancel={() => setDeleteMediaDialogOpen(false)}
      />

      {/* Delete Transcription Confirm Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteTranscriptionDialogOpen}
        title="Transcription の削除"
        resourceName={sessionName || 'Transcription'}
        warningMessage="この操作は取り消せません。関連するすべてのデータ（Segment・Correction・ConsensusResult）が削除されます。"
        onConfirm={handleDeleteTranscription}
        onCancel={() => setDeleteTranscriptionDialogOpen(false)}
      />
    </div>
  );
}

