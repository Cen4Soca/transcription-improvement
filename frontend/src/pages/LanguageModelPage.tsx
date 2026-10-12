import { useState, useEffect, useCallback, useRef } from 'react';
import type { LanguageModelApi, CreateLanguageModelRequest } from '../services/language-model-api';
import type { UseLanguageModelsReturn } from '../hooks/useLanguageModels';
import type { ReviewSession } from '../types/session';
import type { UserRole } from '../types/user';

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
 * - モデル一覧表示（ステータスバッジ付き）
 * - モデル作成フォーム（モデル名入力、BaseModelName 選択、対象 ReviewSession 選択）
 * - Admin/TeamLeader のみアクセス可能（権限チェック）
 * - モデル作成ステータスのポーリング表示
 *
 * Requirements: 6.1, 6.2, 6.5, 6.7, 6.8, 6.9, 6.10, 6.11
 */
export function LanguageModelPage({
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
    modelStatus,
    isPollingStatus,
    statusError,
    startStatusPolling,
    stopStatusPolling,
  } = useLanguageModelsHook;

  const [modelName, setModelName] = useState('');
  const [baseModelName, setBaseModelName] = useState<'NarrowBand' | 'WideBand'>('NarrowBand');
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Permission check: Admin/TeamLeader only
  const hasAccess = userRole === 'ADMIN' || userRole === 'TEAM_LEADER';

  // Load models once when access is granted
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasAccess && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadModels();
    }
  }, [hasAccess, loadModels]);

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

    if (selectedSessionIds.length === 0) {
      setValidationError('対象の校閲セッションを1つ以上選択してください。');
      return false;
    }

    setValidationError(null);
    return true;
  }, [modelName, models, selectedSessionIds]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSuccess(null);

    if (!validateForm()) return;

    const params: CreateLanguageModelRequest = {
      modelName: modelName.trim(),
      baseModelName,
      sessionIds: selectedSessionIds,
    };

    const result = await createModel(params);
    if (result) {
      setCreateSuccess(`モデル「${result.modelName}」の作成を開始しました。`);
      setModelName('');
      setSelectedSessionIds([]);
      startStatusPolling(result.modelName);
      loadModels();
    }
  }, [validateForm, modelName, baseModelName, selectedSessionIds, createModel, startStatusPolling, loadModels]);

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
                  モデル名
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
                    <p className="text-sm text-red-700">{createError.message}</p>
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
                <p className="text-sm text-red-700">{modelsError.message}</p>
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
                  <li key={model.modelName} className="px-6 py-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{model.modelName}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {model.baseModelName && (
                          <span className="text-xs text-gray-500">{model.baseModelName}</span>
                        )}
                        {model.createTime && (
                          <span className="text-xs text-gray-400">
                            {new Date(model.createTime).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                      </div>
                    </div>
                    <ModelStatusBadge status={model.modelStatus} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
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
