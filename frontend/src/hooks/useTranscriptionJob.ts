import { useState, useCallback, useRef, useEffect } from 'react';
import type { TranscriptionApi, TranscriptionJob, TranscriptionJobStatus } from '../services/transcription-api';
import type { AppError } from '../types/api';

export interface UseTranscriptionJobReturn {
  job: TranscriptionJob | null;
  isPolling: boolean;
  error: AppError | null;
  startPolling: (jobId: string) => void;
  stopPolling: () => void;
  fetchStatus: (jobId: string) => Promise<void>;
}

const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES: TranscriptionJobStatus[] = ['COMPLETED', 'FAILED'];

/**
 * useTranscriptionJob - ジョブステータスポーリング
 *
 * - ジョブ ID を指定してステータスをポーリング
 * - COMPLETED または FAILED になったら自動停止
 * - 手動でのポーリング開始・停止をサポート
 *
 * Requirements: 3.10
 */
export function useTranscriptionJob(transcriptionApi: TranscriptionApi): UseTranscriptionJobReturn {
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const apiRef = useRef(transcriptionApi);
  useEffect(() => {
    apiRef.current = transcriptionApi;
  });

  const clearPollingInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async (jobId: string) => {
    const result = await apiRef.current.getJobStatus(jobId);
    if (result.ok) {
      setJob(result.value);
      setError(null);

      // Stop polling if terminal status reached
      if (TERMINAL_STATUSES.includes(result.value.status)) {
        clearPollingInterval();
        setIsPolling(false);
      }
    } else {
      setError(result.error);
    }
  }, [clearPollingInterval]);

  const startPolling = useCallback((jobId: string) => {
    // Clear any existing polling
    clearPollingInterval();
    jobIdRef.current = jobId;
    setIsPolling(true);
    setError(null);

    // Fetch immediately
    fetchStatus(jobId);

    // Set up interval
    intervalRef.current = setInterval(() => {
      if (jobIdRef.current) {
        fetchStatus(jobIdRef.current);
      }
    }, POLL_INTERVAL_MS);
  }, [fetchStatus, clearPollingInterval]);

  const stopPolling = useCallback(() => {
    clearPollingInterval();
    setIsPolling(false);
    jobIdRef.current = null;
  }, [clearPollingInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearPollingInterval();
    };
  }, [clearPollingInterval]);

  return {
    job,
    isPolling,
    error,
    startPolling,
    stopPolling,
    fetchStatus,
  };
}
