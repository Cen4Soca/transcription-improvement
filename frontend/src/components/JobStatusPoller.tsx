import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { TranscriptionApi, TranscriptionJob, TranscriptionJobStatus } from '../services/transcription-api';
import { translateError } from '../utils/translateError';

export interface JobStatusPollerProps {
  jobId: string;
  transcriptionApi: TranscriptionApi;
  pollingIntervalMs?: number;
  onStatusChange?: (job: TranscriptionJob) => void;
  onCompleted?: (job: TranscriptionJob) => void;
  onFailed?: (job: TranscriptionJob) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES: TranscriptionJobStatus[] = ['COMPLETED', 'FAILED'];

/**
 * JobStatusPoller - ジョブステータスポーリングコンポーネント
 *
 * - 指定されたジョブ ID のステータスを 5 秒間隔でポーリング
 * - IN_PROGRESS / COMPLETED / FAILED のステータスを表示
 * - FAILED 時にエラー理由を表示
 * - COMPLETED または FAILED（ターミナルステート）到達時にポーリングを停止
 *
 * Requirements: 17.9, 17.10
 */
export function JobStatusPoller({
  jobId,
  transcriptionApi,
  pollingIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onStatusChange,
  onCompleted,
  onFailed,
}: JobStatusPollerProps) {
  const { t } = useTranslation('transcriptionJob');
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevJobId, setPrevJobId] = useState(jobId);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const onCompletedRef = useRef(onCompleted);
  const onFailedRef = useRef(onFailed);

  // Keep callback refs up to date
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    onCompletedRef.current = onCompleted;
    onFailedRef.current = onFailed;
  });

  // Reset polling state when the jobId changes (adjust state during render).
  if (prevJobId !== jobId) {
    setPrevJobId(jobId);
    setIsPolling(true);
    setError(null);
    setJob(null);
  }

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const fetchStatus = useCallback(async () => {
    const result = await transcriptionApi.getJobStatus(jobId);

    if (result.ok) {
      setJob(result.value);
      setError(null);
      onStatusChangeRef.current?.(result.value);

      if (TERMINAL_STATUSES.includes(result.value.status)) {
        stopPolling();
        if (result.value.status === 'COMPLETED') {
          onCompletedRef.current?.(result.value);
        } else if (result.value.status === 'FAILED') {
          onFailedRef.current?.(result.value);
        }
      }
    } else {
      setError(translateError(result.error));
    }
  }, [jobId, transcriptionApi, stopPolling]);

  useEffect(() => {
    // Fetch immediately
    void (async () => {
      await fetchStatus();
    })();

    // Set up interval polling
    intervalRef.current = setInterval(fetchStatus, pollingIntervalMs);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [jobId, pollingIntervalMs, fetchStatus]);

  // Loading state
  if (!job && !error) {
    return (
      <div
        className="flex items-center justify-center p-6"
        role="status"
        aria-label={t('status.loadingAriaLabel')}
      >
        <div className="w-5 h-5 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <span className="ml-2 text-sm text-gray-500">{t('status.fetchingJob')}</span>
      </div>
    );
  }

  // API error state
  if (error && !job) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg" role="alert">
        <p className="text-sm text-red-700">
          {t('status.fetchFailed', { message: error })}
        </p>
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="space-y-3 bg-white border border-gray-200 rounded-lg p-4" aria-label={t('status.jobStatusPanelAriaLabel')}>
      {/* Header with polling indicator */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{t('status.jobStatus')}</h3>
        {isPolling && (
          <span className="flex items-center gap-1 text-xs text-gray-400" aria-label={t('status.pollingAriaLabel')}>
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" aria-hidden="true" />
            {t('status.autoUpdating')}
          </span>
        )}
      </div>

      {/* Status badge */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${getStatusStyles(job.status)}`}
        role="status"
        aria-live="polite"
        aria-label={t('status.jobStatusAnnounce', { status: getStatusLabel(t, job.status) })}
      >
        <span className="text-base" aria-hidden="true">
          {getStatusIcon(job.status)}
        </span>
        <span className="text-sm font-medium">
          {getStatusLabel(t, job.status)}
        </span>
        {job.status === 'IN_PROGRESS' && (
          <div
            className="ml-auto w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Failure reason */}
      {job.status === 'FAILED' && job.failureReason && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
          <p className="text-xs font-medium text-red-800 mb-1">{t('status.errorDetail')}</p>
          <p className="text-sm text-red-700">{job.failureReason}</p>
        </div>
      )}

      {/* Job details */}
      <dl className="text-xs text-gray-500 space-y-1">
        <div className="flex justify-between">
          <dt>{t('status.jobId')}</dt>
          <dd className="font-mono text-gray-700">{job.jobId}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('status.language')}</dt>
          <dd className="text-gray-700">{job.languageCode}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('status.maxSpeakers')}</dt>
          <dd className="text-gray-700">{job.maxSpeakerLabels}</dd>
        </div>
        {job.languageModelName && (
          <div className="flex justify-between">
            <dt>{t('status.languageModel')}</dt>
            <dd className="text-gray-700">{job.languageModelName}</dd>
          </div>
        )}
      </dl>

      {/* Polling error (non-fatal, job data still shown) */}
      {error && job && (
        <p className="text-xs text-amber-600" role="alert">
          {t('status.latestFetchFailed')}
        </p>
      )}
    </div>
  );
}

function getStatusLabel(t: TFunction, status: TranscriptionJobStatus): string {
  return t(`status.${status}`);
}

function getStatusStyles(status: TranscriptionJobStatus): string {
  const styles: Record<TranscriptionJobStatus, string> = {
    IN_PROGRESS: 'bg-blue-100 text-blue-800 border-blue-200',
    COMPLETED: 'bg-green-100 text-green-800 border-green-200',
    FAILED: 'bg-red-100 text-red-800 border-red-200',
  };
  return styles[status];
}

function getStatusIcon(status: TranscriptionJobStatus): string {
  const icons: Record<TranscriptionJobStatus, string> = {
    IN_PROGRESS: '⏳',
    COMPLETED: '✓',
    FAILED: '✗',
  };
  return icons[status];
}
