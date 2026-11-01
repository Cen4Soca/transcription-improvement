import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  LanguageModelApi,
  CreateLanguageModelRequest,
  LanguageModelSummary,
} from '../services/language-model-api';
import type { UseLanguageModelsReturn } from '../hooks/useLanguageModels';
import type { ReviewSession } from '../types/session';
import type { UserRole } from '../types/user';
import type { Team } from '../types/team';
import type { AppError } from '../types/api';
import { SessionNameEditor } from '../components/SessionNameEditor';
import { describeLanguageModelError } from '../utils/language-model-error';

/** 選択チームに割り当てられた sessionId 集合で候補を絞る（Req 2.1） */
export function filterSessionsByAssignment(
  sessions: ReviewSession[],
  assignedSessionIds: Set<string>
): ReviewSession[] {
  return sessions.filter((s) => assignedSessionIds.has(s.sessionId));
}

/** 前回の選択を新しい割り当て集合に整合させる（= 積集合、Req 2.3） */
export function reconcileSelection(
  prevSelected: string[],
  assignedSessionIds: Set<string>
): string[] {
  return prevSelected.filter((id) => assignedSessionIds.has(id));
}

export interface LanguageModelPageProps {
  languageModelApi: LanguageModelApi;
  useLanguageModelsHook: UseLanguageModelsReturn;
  sessions: ReviewSession[];
  userRole: UserRole;
  isLoadingSessions?: boolean;
}

const BASE_MODEL_OPTIONS: {
  value: 'NarrowBand' | 'WideBand';
  label: string;
  descriptionKey: string;
}[] = [
  { value: 'NarrowBand', label: 'NarrowBand', descriptionKey: 'baseModel.narrowBandDescription' },
  { value: 'WideBand', label: 'WideBand', descriptionKey: 'baseModel.wideBandDescription' },
];

/** Translation key (in the languageModel namespace) for each model status. */
const MODEL_STATUS_LABEL_KEYS: Record<string, string> = {
  IN_PROGRESS: 'status.inProgress',
  COMPLETED: 'status.completed',
  FAILED: 'status.failed',
};

/** Resolve a model status label via i18n, falling back to the raw status. */
function modelStatusLabel(t: TFunction, status: string): string {
  const key = MODEL_STATUS_LABEL_KEYS[status];
  return key ? t(key) : status;
}

/**
 * LanguageModelPage - カスタム言語モデル管理ページ
 *
 * - モデル一覧表示（表示名・チーム列・ステータスバッジ付き）
 * - モデル作成フォーム（モデル名・ベースモデル・チーム選択【必須】・表示名【必須】・対象セッション）
 *   - チーム選択肢: ADMIN=全チーム / TEAM_LEADER=自身の所属チーム（GET /me/teams）
 * - 表示名のインライン編集（校閲セッション名編集を踏襲）
 * - モデル削除（確認ダイアログ付き）
 * - teamId の付け替え（ADMIN のみ）
 * - PENDING（削除保留）モデルの再削除導線（ADMIN 管理ビュー）
 * - クォータ超過（QUOTA_EXCEEDED）は日本語メッセージで明示
 * - Admin/TeamLeader のみアクセス可能（権限チェック）
 *
 * Requirements: 18, 20, 削除 / teamId 編集 / 表示名編集
 */
export function LanguageModelPage({
  languageModelApi,
  useLanguageModelsHook,
  sessions,
  userRole,
  isLoadingSessions = false,
}: LanguageModelPageProps) {
  const { t } = useTranslation('languageModel');
  const {
    models,
    isLoadingModels,
    loadModels,
    modelsError,
    createModel,
    isCreating,
    createError,
    deleteModel,
    renameModel,
    changeModelTeam,
    reDelete,
    modelStatus,
    isPollingStatus,
    statusError,
    startStatusPolling,
    stopStatusPolling,
  } = useLanguageModelsHook;

  const isAdmin = userRole === 'ADMIN';

  const [modelName, setModelName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [baseModelName, setBaseModelName] = useState<'NarrowBand' | 'WideBand'>('NarrowBand');
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Source-session candidate filtering: only sessions assigned (TeamAssignment)
  // to the selected TargetTeam are offered as candidates. This mirrors the
  // backend `hasTeamAssignment` gate so the frontend candidates and the
  // backend-accepted set stay in sync (Req 2.1).
  const [assignedSessionIds, setAssignedSessionIds] = useState<Set<string>>(new Set());
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

  // Teams for the required create-form selector.
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);

  // Models that failed to delete mid-teardown (left PENDING) — tracked locally
  // so the ADMIN management view can offer a re-delete affordance.
  const [pendingModels, setPendingModels] = useState<LanguageModelSummary[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Permission check: Admin/TeamLeader only
  const hasAccess = userRole === 'ADMIN' || userRole === 'TEAM_LEADER';

  // Load models + teams once when access is granted
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (!hasAccess || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadModels();

    let cancelled = false;
    (async () => {
      setIsLoadingTeams(true);
      const result = await languageModelApi.getMyTeams();
      if (!cancelled && result.ok) {
        setTeams(result.value.data);
      }
      if (!cancelled) setIsLoadingTeams(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasAccess, loadModels, languageModelApi]);

  const handleSessionToggle = useCallback((sessionId: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId]
    );
  }, []);

  // Re-fetch the selected team's TeamAssignment set whenever the team changes.
  // Empty team -> empty set. Fetch failure -> empty set fallback (the backend
  // remains the authoritative final validator). Guarded against races with
  // `cancelled` (Req 2.2).
  useEffect(() => {
    if (!teamId) {
      setAssignedSessionIds(new Set());
      return;
    }
    let cancelled = false;
    setIsLoadingAssignments(true);
    (async () => {
      const result = await languageModelApi.listTeamAssignments(teamId);
      if (cancelled) return;
      const ids = result.ok
        ? new Set(result.value.data.map((a) => a.sessionId))
        : new Set<string>();
      setAssignedSessionIds(ids);
      setIsLoadingAssignments(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, languageModelApi]);

  // Candidate sessions = props `sessions` narrowed to the assignment set (Req 2.1).
  const candidateSessions = useMemo(
    () => filterSessionsByAssignment(sessions, assignedSessionIds),
    [sessions, assignedSessionIds]
  );

  // Reconcile the prior selection against the new assignment set, dropping any
  // selected session that is not assigned to the newly selected team (Req 2.3).
  //
  // ★ Single extension point for cascading resets of inputs that depend on the
  //   SourceReviewSession selection (Req 2.4). This is the one place that reacts
  //   to a *shrinking* of the session selection. The current create form has no
  //   companion inputs that depend on which source sessions are selected, so for
  //   now we only reconcile `selectedSessionIds`. When such derived state is
  //   added later (e.g. per-session companion settings), reset the derived state
  //   tied to the sessionIds removed by `reconcileSelection` here — on the same
  //   trigger, in the same place — so the reconciliation responsibility stays
  //   consolidated rather than scattered.
  useEffect(() => {
    setSelectedSessionIds((prev) => {
      const next = reconcileSelection(prev, assignedSessionIds);
      // If the selection shrank (next ⊊ prev), this branch is the future starting
      // point for dependent-input resets: compute removed = prev - next and
      // reconcile derived state here once such inputs exist.
      return next.length === prev.length ? prev : next;
    });
  }, [assignedSessionIds]);

  const validateForm = useCallback((): boolean => {
    if (!modelName.trim()) {
      setValidationError(t('validation.modelNameRequired'));
      return false;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(modelName.trim())) {
      setValidationError(t('validation.modelNameFormat'));
      return false;
    }

    // Check for duplicate model name
    const existingNames = models.map((m) => m.modelName);
    if (existingNames.includes(modelName.trim())) {
      setValidationError(t('validation.modelNameDuplicate'));
      return false;
    }

    if (!displayName.trim()) {
      setValidationError(t('validation.displayNameRequired'));
      return false;
    }

    if (!teamId) {
      setValidationError(t('validation.teamRequired'));
      return false;
    }

    if (selectedSessionIds.length === 0) {
      setValidationError(t('validation.sessionRequired'));
      return false;
    }

    setValidationError(null);
    return true;
  }, [modelName, displayName, teamId, models, selectedSessionIds, t]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSuccess(null);

    if (!validateForm()) return;

    const params: CreateLanguageModelRequest = {
      modelName: modelName.trim(),
      baseModelName,
      teamId,
      displayName: displayName.trim(),
      sessionIds: selectedSessionIds,
    };

    const result = await createModel(params);
    if (result) {
      setCreateSuccess(t('createSuccess', { name: result.displayName ?? result.modelName }));
      setModelName('');
      setDisplayName('');
      setSelectedSessionIds([]);
      startStatusPolling(result.modelName);
      loadModels();
    }
  }, [validateForm, modelName, displayName, teamId, baseModelName, selectedSessionIds, createModel, startStatusPolling, loadModels, t]);

  // --- Row actions ---

  const handleRename = useCallback(
    async (modelNameToRename: string, newName: string): Promise<AppError | null> => {
      return renameModel(modelNameToRename, newName);
    },
    [renameModel]
  );

  const handleDelete = useCallback(
    async (model: LanguageModelSummary) => {
      setActionMessage(null);
      setActionError(null);
      const ok = await deleteModel(model.modelName);
      if (ok) {
        setActionMessage(t('action.deleteSuccess', { name: model.displayName ?? model.modelName }));
        setPendingModels((prev) => prev.filter((m) => m.modelName !== model.modelName));
      } else {
        // Delete failed mid-teardown: the model is now PENDING. Track it so the
        // ADMIN management view can offer a re-delete.
        setActionError(
          t('action.deleteFailure', { name: model.displayName ?? model.modelName })
        );
        setPendingModels((prev) =>
          prev.some((m) => m.modelName === model.modelName) ? prev : [...prev, model]
        );
      }
    },
    [deleteModel, t]
  );

  const handleReDelete = useCallback(
    async (model: LanguageModelSummary) => {
      setActionMessage(null);
      setActionError(null);
      const ok = await reDelete(model.modelName);
      if (ok) {
        setActionMessage(t('action.reDeleteSuccess', { name: model.displayName ?? model.modelName }));
        setPendingModels((prev) => prev.filter((m) => m.modelName !== model.modelName));
      } else {
        setActionError(
          t('action.reDeleteFailure', { name: model.displayName ?? model.modelName })
        );
      }
    },
    [reDelete, t]
  );

  const handleChangeTeam = useCallback(
    async (modelNameToChange: string, newTeamId: string): Promise<AppError | null> => {
      return changeModelTeam(modelNameToChange, newTeamId);
    },
    [changeModelTeam]
  );

  // Access denied for Reviewer
  if (!hasAccess) {
    return (
      <div className="flex flex-col h-full" role="main" aria-label={t('pageTitle')}>
        <div className="px-4 py-3 border-b border-gray-200 bg-white">
          <h1 className="text-lg font-semibold text-gray-900">{t('pageTitle')}</h1>
        </div>
        <div className="flex items-center justify-center h-64" role="alert">
          <div className="text-center">
            <p className="text-red-600 font-medium">{t('accessDenied')}</p>
            <p className="text-sm text-gray-500 mt-1">
              {t('accessDeniedDescription')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" role="main" aria-label={t('pageTitle')}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('pageDescription')}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Model status polling display */}
          {isPollingStatus && modelStatus && (
            <ModelStatusBanner
              modelStatus={modelStatus}
              statusError={statusError}
              onStopPolling={stopStatusPolling}
              t={t}
            />
          )}

          {/* Model creation form */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">{t('form.title')}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Model name */}
              <div>
                <label htmlFor="model-name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('form.modelName')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="model-name"
                  type="text"
                  value={modelName}
                  onChange={(e) => {
                    setModelName(e.target.value);
                    setValidationError(null);
                  }}
                  placeholder={t('form.modelNamePlaceholder')}
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                  aria-describedby="model-name-hint"
                />
                <p id="model-name-hint" className="mt-1 text-xs text-gray-500">
                  {t('form.modelNameHint')}
                </p>
              </div>

              {/* Display name (required) */}
              <div>
                <label htmlFor="display-name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('form.displayName')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setValidationError(null);
                  }}
                  placeholder={t('form.displayNamePlaceholder')}
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                  aria-describedby="display-name-hint"
                />
                <p id="display-name-hint" className="mt-1 text-xs text-gray-500">
                  {t('form.displayNameHint')}
                </p>
              </div>

              {/* Team selection (required) */}
              <div>
                <label htmlFor="team-select" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('form.team')} <span className="text-red-500">*</span>
                </label>
                {isLoadingTeams ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    <span>{t('form.teamLoading')}</span>
                  </div>
                ) : teams.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">{t('form.noTeams')}</p>
                ) : (
                  <select
                    id="team-select"
                    value={teamId}
                    onChange={(e) => {
                      setTeamId(e.target.value);
                      setValidationError(null);
                    }}
                    disabled={isCreating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                    aria-describedby="team-select-hint"
                  >
                    <option value="">{t('form.teamSelectPlaceholder')}</option>
                    {teams.map((team) => (
                      <option key={team.teamId} value={team.teamId}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                )}
                <p id="team-select-hint" className="mt-1 text-xs text-gray-500">
                  {isAdmin
                    ? t('form.teamHintAdmin')
                    : t('form.teamHintMember')}
                </p>
              </div>

              {/* Base model selection */}
              <div>
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-700 mb-2">
                    {t('form.baseModel')}
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {BASE_MODEL_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`relative flex items-start p-3 border rounded-lg cursor-pointer transition-colors ${
                          baseModelName === option.value
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                            : 'border-gray-300 hover:border-gray-400'
                        } ${isCreating ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <input
                          type="radio"
                          name="baseModelName"
                          value={option.value}
                          checked={baseModelName === option.value}
                          onChange={() => setBaseModelName(option.value)}
                          disabled={isCreating}
                          className="mt-0.5 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <div className="ml-3">
                          <span className="text-sm font-medium text-gray-900">{option.label}</span>
                          <p className="text-xs text-gray-500 mt-0.5">{t(option.descriptionKey)}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              {/* Session selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('form.targetSessions')}
                </label>
                {isLoadingSessions || isLoadingAssignments ? (
                  <div
                    className="flex items-center gap-2 text-sm text-gray-500 py-2"
                    role="status"
                    aria-label={isLoadingAssignments ? t('form.assignmentLoadingAriaLabel') : t('form.sessionLoadingAriaLabel')}
                  >
                    <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    <span>{isLoadingAssignments ? t('form.assignmentLoading') : t('form.sessionLoading')}</span>
                  </div>
                ) : !teamId ? (
                  <p className="text-sm text-gray-500 py-2">{t('form.selectTeamFirst')}</p>
                ) : candidateSessions.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">
                    {t('form.noAssignedSessions')}
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {candidateSessions.map((session) => (
                      <label
                        key={session.sessionId}
                        className={`flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer ${
                          isCreating ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSessionIds.includes(session.sessionId)}
                          onChange={() => handleSessionToggle(session.sessionId)}
                          disabled={isCreating}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div className="ml-3 min-w-0">
                          <span className="text-sm text-gray-900 truncate block">{session.name}</span>
                          <span className="text-xs text-gray-500">{t(`sessionStatus.${session.status}`)}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                {selectedSessionIds.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('form.selectedCount', { count: selectedSessionIds.length })}
                  </p>
                )}
              </div>

              {/* Validation error */}
              {validationError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert" aria-live="assertive">
                  <p className="text-sm text-red-700">{validationError}</p>
                </div>
              )}

              {/* Create error */}
              {createError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert" aria-live="assertive">
                  <div className="flex items-start gap-2">
                    <svg className="h-5 w-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <p className="text-sm text-red-700">{describeLanguageModelError(createError)}</p>
                  </div>
                </div>
              )}

              {/* Success message */}
              {createSuccess && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3" role="status" aria-live="polite">
                  <div className="flex items-start gap-2">
                    <svg className="h-5 w-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm text-green-700">{createSuccess}</p>
                  </div>
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={isCreating}
                className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCreating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('form.creating')}
                  </span>
                ) : (
                  t('form.submit')
                )}
              </button>
            </form>
          </div>

          {/* Row action feedback */}
          {actionMessage && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3" role="status" aria-live="polite">
              <p className="text-sm text-green-700">{actionMessage}</p>
            </div>
          )}
          {actionError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700">{actionError}</p>
            </div>
          )}

          {/* Model list */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{t('list.title')}</h2>
              <button
                type="button"
                onClick={loadModels}
                disabled={isLoadingModels}
                className="text-sm text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 disabled:opacity-50"
                aria-label={t('list.refreshAriaLabel')}
              >
                {isLoadingModels ? t('list.loading') : t('list.refresh')}
              </button>
            </div>

            {modelsError && (
              <div className="px-6 py-3 bg-red-50 border-b border-red-200" role="alert">
                <p className="text-sm text-red-700">{describeLanguageModelError(modelsError)}</p>
              </div>
            )}

            {isLoadingModels ? (
              <div className="flex items-center justify-center py-12" role="status" aria-label={t('list.loadingAriaLabel')}>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                  <span className="text-sm text-gray-500">{t('list.loading')}</span>
                </div>
              </div>
            ) : models.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-gray-500">{t('list.empty')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100" aria-label={t('list.ariaLabel')}>
                {models.map((model) => (
                  <ModelListItem
                    key={model.modelName}
                    model={model}
                    teams={teams}
                    isAdmin={isAdmin}
                    onRename={handleRename}
                    onChangeTeam={handleChangeTeam}
                    onDelete={handleDelete}
                    t={t}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* ADMIN: PENDING (soft-deleted) models management view */}
          {isAdmin && pendingModels.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-lg" aria-label={t('pending.sectionAriaLabel')}>
              <div className="px-6 py-4 border-b border-amber-200">
                <h2 className="text-base font-semibold text-amber-800">{t('pending.title')}</h2>
                <p className="mt-1 text-xs text-amber-700">
                  {t('pending.description')}
                </p>
              </div>
              <ul className="divide-y divide-amber-100" aria-label={t('pending.listAriaLabel')}>
                {pendingModels.map((model) => (
                  <li key={model.modelName} className="px-6 py-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {model.displayName ?? model.modelName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{model.modelName}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReDelete(model)}
                      className="px-3 py-1 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {t('pending.reDelete')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ModelListItem - モデル一覧の 1 行。
 * 表示名のインライン編集・チーム列・（ADMIN の）teamId 付け替え・削除を提供する。
 */
function ModelListItem({
  model,
  teams,
  isAdmin,
  onRename,
  onChangeTeam,
  onDelete,
  t,
}: {
  model: LanguageModelSummary;
  teams: Team[];
  isAdmin: boolean;
  onRename: (modelName: string, name: string) => Promise<AppError | null>;
  onChangeTeam: (modelName: string, teamId: string) => Promise<AppError | null>;
  onDelete: (model: LanguageModelSummary) => Promise<void>;
  t: TFunction;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [teamDraft, setTeamDraft] = useState(model.teamId ?? '');
  const [teamError, setTeamError] = useState<string | null>(null);
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  const teamName = teams.find((t) => t.teamId === model.teamId)?.name ?? model.teamId ?? '—';

  const handleSaveTeam = async () => {
    setTeamError(null);
    setIsSavingTeam(true);
    try {
      const error = await onChangeTeam(model.modelName, teamDraft);
      if (error) {
        setTeamError(describeLanguageModelError(error));
        return;
      }
      setIsEditingTeam(false);
    } finally {
      setIsSavingTeam(false);
    }
  };

  return (
    <li className="px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          {/* Inline display-name editor */}
          <SessionNameEditor
            name={model.displayName ?? model.modelName}
            onSave={(name) => onRename(model.modelName, name)}
          />
          <p className="text-xs text-gray-500 truncate">{t('list.modelName', { modelName: model.modelName })}</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{t('list.team', { team: teamName })}</span>
            {model.baseModelName && (
              <span className="text-xs text-gray-500">{model.baseModelName}</span>
            )}
            {model.createTime && (
              <span className="text-xs text-gray-400">
                {new Date(model.createTime).toLocaleDateString('ja-JP')}
              </span>
            )}
          </div>

          {/* ADMIN: teamId edit control */}
          {isAdmin && (
            <div className="pt-1">
              {isEditingTeam ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label htmlFor={`team-edit-${model.modelName}`} className="text-xs text-gray-600">
                      {t('list.changeTeam')}
                    </label>
                    <select
                      id={`team-edit-${model.modelName}`}
                      value={teamDraft}
                      onChange={(e) => setTeamDraft(e.target.value)}
                      disabled={isSavingTeam}
                      className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <option value="">{t('form.teamSelectPlaceholder')}</option>
                      {teams.map((team) => (
                        <option key={team.teamId} value={team.teamId}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleSaveTeam}
                      disabled={isSavingTeam || !teamDraft}
                      className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {isSavingTeam ? t('list.saving') : t('list.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingTeam(false);
                        setTeamDraft(model.teamId ?? '');
                        setTeamError(null);
                      }}
                      disabled={isSavingTeam}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
                    >
                      {t('list.cancel')}
                    </button>
                  </div>
                  {teamError && (
                    <p role="alert" className="text-sm text-red-600">
                      {teamError}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingTeam(true)}
                  className="text-xs text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                >
                  {t('list.changeTeam')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <ModelStatusBadge status={model.modelStatus} t={t} />
          {confirmingDelete ? (
            <div className="flex flex-col items-end gap-2" role="alertdialog" aria-label={t('list.deleteConfirmAriaLabel')}>
              <p className="text-xs text-gray-700">{t('list.deleteConfirmPrompt', { name: model.displayName ?? model.modelName })}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmingDelete(false);
                    await onDelete(model);
                  }}
                  className="px-3 py-1 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {t('list.deleteConfirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {t('list.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={t('list.deleteAriaLabel', { name: model.displayName ?? model.modelName })}
              className="px-3 py-1 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {t('list.delete')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * ModelStatusBadge - モデルステータスバッジ
 */
function ModelStatusBadge({ status, t }: { status: string; t: TFunction }) {
  const colorClasses: Record<string, string> = {
    IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
  };

  const classes = colorClasses[status] || 'bg-gray-100 text-gray-700';
  const label = modelStatusLabel(t, status);

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${classes}`}>
      {label}
    </span>
  );
}

/**
 * ModelStatusBanner - モデル作成ステータスのポーリング表示バナー
 */
function ModelStatusBanner({
  modelStatus,
  statusError,
  onStopPolling,
  t,
}: {
  modelStatus: { modelName: string; modelStatus: string; failureReason?: string };
  statusError: { message: string } | null;
  onStopPolling: () => void;
  t: TFunction;
}) {
  const isTerminal = modelStatus.modelStatus === 'COMPLETED' || modelStatus.modelStatus === 'FAILED';

  return (
    <div
      className={`border rounded-lg p-4 ${
        modelStatus.modelStatus === 'COMPLETED'
          ? 'bg-green-50 border-green-200'
          : modelStatus.modelStatus === 'FAILED'
            ? 'bg-red-50 border-red-200'
            : 'bg-blue-50 border-blue-200'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isTerminal && (
            <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          )}
          {modelStatus.modelStatus === 'COMPLETED' && (
            <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {modelStatus.modelStatus === 'FAILED' && (
            <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">
              {t('banner.modelStatus', {
                modelName: modelStatus.modelName,
                status: modelStatusLabel(t, modelStatus.modelStatus),
              })}
            </p>
            {modelStatus.failureReason && (
              <p className="text-xs text-red-600 mt-0.5">{modelStatus.failureReason}</p>
            )}
            {statusError && (
              <p className="text-xs text-red-600 mt-0.5">{t('banner.statusError', { message: statusError.message })}</p>
            )}
          </div>
        </div>
        {isTerminal && (
          <button
            type="button"
            onClick={onStopPolling}
            className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          >
            {t('banner.close')}
          </button>
        )}
      </div>
    </div>
  );
}
