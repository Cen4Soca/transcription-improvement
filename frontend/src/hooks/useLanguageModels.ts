import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  LanguageModelApi,
  LanguageModelSummary,
  LanguageModelStatus,
  CreateLanguageModelRequest,
  LanguageModelRecord,
} from '../services/language-model-api';
import type { AppError } from '../types/api';

export interface UseLanguageModelsReturn {
  models: LanguageModelSummary[];
  isLoadingModels: boolean;
  loadModels: () => Promise<void>;
  modelsError: AppError | null;
  createModel: (params: CreateLanguageModelRequest) => Promise<LanguageModelRecord | null>;
  isCreating: boolean;
  createError: AppError | null;
  modelStatus: LanguageModelStatus | null;
  isPollingStatus: boolean;
  statusError: AppError | null;
  startStatusPolling: (modelName: string) => void;
  stopStatusPolling: () => void;
}

const STATUS_POLL_INTERVAL_MS = 10000;
const TERMINAL_MODEL_STATUSES = ['COMPLETED', 'FAILED'];

/**
 * useLanguageModels - カスタム言語モデル一覧・ステータス管理
 *
 * - モデル一覧の取得
 * - モデル作成リクエスト
 * - モデルステータスのポーリング（IN_PROGRESS → COMPLETED/FAILED）
 *
 * Requirements: 6.7
 */
export function useLanguageModels(languageModelApi: LanguageModelApi): UseLanguageModelsReturn {
  const [models, setModels] = useState<LanguageModelSummary[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<AppError | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<AppError | null>(null);

  const [modelStatus, setModelStatus] = useState<LanguageModelStatus | null>(null);
  const [isPollingStatus, setIsPollingStatus] = useState(false);
  const [statusError, setStatusError] = useState<AppError | null>(null);

  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelNameRef = useRef<string | null>(null);
  const apiRef = useRef(languageModelApi);
  useEffect(() => {
    apiRef.current = languageModelApi;
  });

  const clearStatusInterval = useCallback(() => {
    if (statusIntervalRef.current !== null) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
  }, []);

  const isLoadingRef = useRef(false);

  const loadModels = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoadingModels(true);
    setModelsError(null);
    try {
      const result = await apiRef.current.listModels();
      if (result.ok) {
        setModels(result.value.models);
      } else {
        setModelsError(result.error);
      }
    } finally {
      setIsLoadingModels(false);
      isLoadingRef.current = false;
    }
  }, []);

  const createModel = useCallback(async (params: CreateLanguageModelRequest): Promise<LanguageModelRecord | null> => {
    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await apiRef.current.createModel(params);
      if (result.ok) {
        return result.value;
      } else {
        setCreateError(result.error);
        return null;
      }
    } finally {
      setIsCreating(false);
    }
  }, []);

  const fetchModelStatus = useCallback(async (modelName: string) => {
    const result = await apiRef.current.getModelStatus(modelName);
    if (result.ok) {
      setModelStatus(result.value);
      setStatusError(null);

      // Stop polling if terminal status reached
      if (TERMINAL_MODEL_STATUSES.includes(result.value.modelStatus)) {
        clearStatusInterval();
        setIsPollingStatus(false);
      }
    } else {
      setStatusError(result.error);
    }
  }, [clearStatusInterval]);

  const startStatusPolling = useCallback((modelName: string) => {
    clearStatusInterval();
    modelNameRef.current = modelName;
    setIsPollingStatus(true);
    setStatusError(null);

    // Fetch immediately
    fetchModelStatus(modelName);

    // Set up interval
    statusIntervalRef.current = setInterval(() => {
      if (modelNameRef.current) {
        fetchModelStatus(modelNameRef.current);
      }
    }, STATUS_POLL_INTERVAL_MS);
  }, [fetchModelStatus, clearStatusInterval]);

  const stopStatusPolling = useCallback(() => {
    clearStatusInterval();
    setIsPollingStatus(false);
    modelNameRef.current = null;
  }, [clearStatusInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearStatusInterval();
    };
  }, [clearStatusInterval]);

  return {
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
  };
}
