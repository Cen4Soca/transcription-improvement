import { useState, useEffect, useCallback, useRef } from 'react';
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

export interface LanguageModelPageProps {
  languageModelApi: LanguageModelApi;
  useLanguageModelsHook: UseLanguageModelsReturn;
  sessions: ReviewSession[];
  userRole: UserRole;
  isLoadingSessions?: boolean;
}

const BASE_MODEL_OPTIONS: { value: 'NarrowBand' | 'WideBand'; label: string; description: string }[] = [
  { value: 'NarrowBand', label: 'NarrowBand', description: '電話音声（8kHz）向け' },
  { value: 'WideBand', label: 'WideBand', description: '高品質音声（16kHz）向け' },
];

const MODEL_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: '作成中',
  COMPLETED: '完了',
  FAILED: '失敗',
};

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

  const validateForm = useCallback((): boolean => {
    if (!modelName.trim()) {
      setValidationError('モデル名を入力してください。');
      return false;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(modelName.trim())) {
      setValidationError('モデル名は英数字、ハイフン、アンダースコアのみ使用できます。');
      return false;
    }

    // Check for duplicate model name
    const existingNames = models.map((m) => m.modelName);
    if (existingNames.includes(modelName.trim())) {
      setValidationError('同じ名前のモデルが既に存在します。別の名前を指定してください。');
      return false;
    }

    if (!displayName.trim()) {
      setValidationError('表示名を入力してください。');
      return false;
    }

    if (!teamId) {
      setValidationError('チームを選択してください。');
      return false;
    }

    if (selectedSessionIds.length === 0) {
      setValidationError('対象の校閲セッションを1つ以上選択してください。');
      return false;
    }

    setValidationError(null);
    return true;
  }, [modelName, displayName, teamId, models, selectedSessionIds]);

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
      setCreateSuccess(`モデル「${result.displayName ?? result.modelName}」の作成を開始しました。`);
      setModelName('');
      setDisplayName('');
      setSelectedSessionIds([]);
      startStatusPolling(result.modelName);
      loadModels();
    }
  }, [validateForm, modelName, displayName, teamId, baseModelName, selectedSessionIds, createModel, startStatusPolling, loadModels]);

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
        setActionMessage(`モデル「${model.displayName ?? model.modelName}」を削除しました。`);
        setPendingModels((prev) => prev.filter((m) => m.modelName !== model.modelName));
      } else {
        // Delete failed mid-teardown: the model is now PENDING. Track it so the
        // ADMIN management view can offer a re-delete.
        setActionError(
          `モデル「${model.displayName ?? model.modelName}」の削除に失敗しました。削除保留中のモデルから再試行できます。`
        );
        setPendingModels((prev) =>
          prev.some((m) => m.modelName === model.modelName) ? prev : [...prev, model]
        );
      }
    },
    [deleteModel]
  );

  const handleReDelete = useCallback(
    async (model: LanguageModelSummary) => {
      setActionMessage(null);
      setActionError(null);
      const ok = await reDelete(model.modelName);
      if (ok) {
        setActionMessage(`削除保留中のモデル「${model.displayName ?? model.modelName}」を削除しました。`);
        setPendingModels((prev) => prev.filter((m) => m.modelName !== model.modelName));
      } else {
        setActionError(
          `モデル「${model.displayName ?? model.modelName}」の再削除に失敗しました。しばらくしてからもう一度お試しください。`
        );
      }
    },
    [reDelete]
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
      <div className="flex flex-col h-full" role="main" aria-label="カスタム言語モデル管理">
        <div className="px-4 py-3 border-b border-gray-200 bg-white">
          <h1 className="text-lg font-semibold text-gray-900">カスタム言語モデル管理</h1>
        </div>
        <div className="flex items-center justify-center h-64" role="alert">
          <div className="text-center">
            <p className="text-red-600 font-medium">アクセス権限がありません</p>
            <p className="text-sm text-gray-500 mt-1">
              この機能は Admin または TeamLeader のみ利用できます。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" role="main" aria-label="カスタム言語モデル管理">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">カスタム言語モデル管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          修正後の Transcription に基づいてカスタム言語モデルを作成・管理します
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
            />
          )}

          {/* Model creation form */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">新規モデル作成</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Model name */}
              <div>
                <label htmlFor="model-name" className="block text-sm font-medium text-gray-700 mb-1">
                  モデル名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="model-name"
                  type="text"
                  value={modelName}
                  onChange={(e) => {
                    setModelName(e.target.value);
                    setValidationError(null);
                  }}
                  placeholder="例: my-custom-model"
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                  aria-describedby="model-name-hint"
                />
                <p id="model-name-hint" className="mt-1 text-xs text-gray-500">
                  英数字、ハイフン、アンダースコアのみ使用可能
                </p>
              </div>

              {/* Display name (required) */}
              <div>
                <label htmlFor="display-name" className="block text-sm font-medium text-gray-700 mb-1">
                  表示名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setValidationError(null);
                  }}
                  placeholder="例: 営業ドメイン v1"
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                  aria-describedby="display-name-hint"
                />
                <p id="display-name-hint" className="mt-1 text-xs text-gray-500">
                  一覧に表示される人間が判別しやすい名前（チーム内で一意）
                </p>
              </div>

              {/* Team selection (required) */}
              <div>
                <label htmlFor="team-select" className="block text-sm font-medium text-gray-700 mb-1">
                  チーム <span className="text-red-500">*</span>
                </label>
                {isLoadingTeams ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    <span>チーム読み込み中...</span>
                  </div>
                ) : teams.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">所属しているチームがありません。</p>
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
                    <option value="">チームを選択...</option>
                    {teams.map((team) => (
                      <option key={team.teamId} value={team.teamId}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                )}
                <p id="team-select-hint" className="mt-1 text-xs text-gray-500">
                  {isAdmin
                    ? '全チームから選択できます。'
                    : '所属しているチームから選択できます。'}
                </p>
              </div>

              {/* Base model selection */}
              <div>
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-700 mb-2">
                    ベースモデル
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
                          <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              {/* Session selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  対象校閲セッション
                </label>
                {isLoadingSessions ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    <span>セッション読み込み中...</span>
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">利用可能な校閲セッションがありません。</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {sessions.map((session) => (
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
                          <span className="text-xs text-gray-500">{session.status === 'COMPLETED' ? '完了' : session.status === 'IN_PROGRESS' ? '進行中' : '未着手'}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                {selectedSessionIds.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {selectedSessionIds.length} 件選択中
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
                    作成中...
                  </span>
                ) : (
                  'モデルを作成'
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
              <h2 className="text-base font-semibold text-gray-900">モデル一覧</h2>
              <button
                type="button"
                onClick={loadModels}
                disabled={isLoadingModels}
                className="text-sm text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 disabled:opacity-50"
                aria-label="モデル一覧を更新"
              >
                {isLoadingModels ? '読み込み中...' : '更新'}
              </button>
            </div>

            {modelsError && (
              <div className="px-6 py-3 bg-red-50 border-b border-red-200" role="alert">
                <p className="text-sm text-red-700">{describeLanguageModelError(modelsError)}</p>
              </div>
            )}

            {isLoadingModels ? (
              <div className="flex items-center justify-center py-12" role="status" aria-label="読み込み中">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                  <span className="text-sm text-gray-500">読み込み中...</span>
                </div>
              </div>
            ) : models.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-gray-500">カスタム言語モデルがありません</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100" aria-label="カスタム言語モデル一覧">
                {models.map((model) => (
                  <ModelListItem
                    key={model.modelName}
                    model={model}
                    teams={teams}
                    isAdmin={isAdmin}
                    onRename={handleRename}
                    onChangeTeam={handleChangeTeam}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* ADMIN: PENDING (soft-deleted) models management view */}
          {isAdmin && pendingModels.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-lg" aria-label="削除保留中のモデル">
              <div className="px-6 py-4 border-b border-amber-200">
                <h2 className="text-base font-semibold text-amber-800">削除保留中のモデル</h2>
                <p className="mt-1 text-xs text-amber-700">
                  削除処理が途中で失敗したモデルです。再削除で処理を再開できます。
                </p>
              </div>
              <ul className="divide-y divide-amber-100" aria-label="削除保留中のモデル一覧">
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
                      再削除
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
}: {
  model: LanguageModelSummary;
  teams: Team[];
  isAdmin: boolean;
  onRename: (modelName: string, name: string) => Promise<AppError | null>;
  onChangeTeam: (modelName: string, teamId: string) => Promise<AppError | null>;
  onDelete: (model: LanguageModelSummary) => Promise<void>;
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
          <p className="text-xs text-gray-500 truncate">モデル名: {model.modelName}</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">チーム: {teamName}</span>
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
                      チームを変更
                    </label>
                    <select
                      id={`team-edit-${model.modelName}`}
                      value={teamDraft}
                      onChange={(e) => setTeamDraft(e.target.value)}
                      disabled={isSavingTeam}
                      className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <option value="">チームを選択...</option>
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
                      {isSavingTeam ? '保存中...' : '保存'}
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
                      キャンセル
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
                  チームを変更
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <ModelStatusBadge status={model.modelStatus} />
          {confirmingDelete ? (
            <div className="flex flex-col items-end gap-2" role="alertdialog" aria-label="モデル削除の確認">
              <p className="text-xs text-gray-700">「{model.displayName ?? model.modelName}」を削除しますか？</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmingDelete(false);
                    await onDelete(model);
                  }}
                  className="px-3 py-1 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  削除する
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={`モデル「${model.displayName ?? model.modelName}」を削除`}
              className="px-3 py-1 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              削除
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
function ModelStatusBadge({ status }: { status: string }) {
  const colorClasses: Record<string, string> = {
    IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
  };

  const classes = colorClasses[status] || 'bg-gray-100 text-gray-700';
  const label = MODEL_STATUS_LABELS[status] || status;

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
}: {
  modelStatus: { modelName: string; modelStatus: string; failureReason?: string };
  statusError: { message: string } | null;
  onStopPolling: () => void;
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
              モデル「{modelStatus.modelName}」: {MODEL_STATUS_LABELS[modelStatus.modelStatus] || modelStatus.modelStatus}
            </p>
            {modelStatus.failureReason && (
              <p className="text-xs text-red-600 mt-0.5">{modelStatus.failureReason}</p>
            )}
            {statusError && (
              <p className="text-xs text-red-600 mt-0.5">ステータス取得エラー: {statusError.message}</p>
            )}
          </div>
        </div>
        {isTerminal && (
          <button
            type="button"
            onClick={onStopPolling}
            className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          >
            閉じる
          </button>
        )}
      </div>
    </div>
  );
}
