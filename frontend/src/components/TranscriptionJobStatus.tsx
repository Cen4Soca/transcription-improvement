import { useEffect } from 'react';
import type { TranscriptionApi, TranscriptionJobStatus as JobStatus } from '../services/transcription-api';
import type { UseTranscriptionJobReturn } from '../hooks/useTranscriptionJob';
import { useTranscriptionJob } from '../hooks/useTranscriptionJob';

export interface TranscriptionJobStatusProps {
  jobId: string;
  transcriptionApi: TranscriptionApi;
}

export interface TranscriptionJobStatusWithHookProps {
  jobId: string;
  hook: UseTranscriptionJobReturn;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  IN_PROGRESS: '処理中',
  COMPLETED: '完了',
  FAILED: '失敗',
};

const STATUS_STYLES: Record<JobStatus, string> = {
  IN_PROGRESS: 'bg-blue-100 text-blue-800 border-blue-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_ICONS: Record<JobStatus, string> = {
  IN_PROGRESS: '⏳',
  COMPLETED: '✓',
  FAILED: '✗',
};

/**
 * TranscriptionJobStatus - ジョブステータス表示コンポーネント
 *
 * - ジョブステータス（IN_PROGRESS, COMPLETED, FAILED）のリアルタイム表示（ポーリング）
 * - 失敗時のエラーメッセージ表示
 * - useTranscriptionJob hook を使用
 *
 * Requirements: 3.9, 3.10
 */
export function TranscriptionJobStatus({ jobId, transcriptionApi }: TranscriptionJobStatusProps) {
  const hook = useTranscriptionJob(transcriptionApi);
  return <TranscriptionJobStatusInner jobId={jobId} hook={hook} />;
}

/**
 * TranscriptionJobStatusInner - hook を外部から注入可能なバージョン（テスト用）
 */
export function TranscriptionJobStatusInner({ jobId, hook }: TranscriptionJobStatusWithHookProps) {
  const { job, isPolling, error, startPolling, stopPolling } = hook;

  useEffect(() => {
    startPolling(jobId);
    return () => {
      stopPolling();
    };
  }, [jobId, startPolling, stopPolling]);

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg" role="alert">
        <p className="text-sm text-red-700">
          ステータスの取得に失敗しました: {error.message}
        </p>
      </div>
    );
  }

  if (!job) {
    return (
      <div
        className="flex items-center justify-center h-24"
        role="status"
        aria-label="読み込み中"
      >
        <div className="w-5 h-5 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <span className="ml-2 text-sm text-gray-500">ジョブ情報を取得中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-label="Transcription ジョブステータス">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">ジョブステータス</h3>
        {isPolling && (
          <span className="text-xs text-gray-400" aria-label="ポーリング中">
            自動更新中...
          </span>
        )}
      </div>

      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${STATUS_STYLES[job.status]}`}
        role="status"
        aria-live="polite"
        aria-label={`ジョブステータス: ${STATUS_LABELS[job.status]}`}
      >
        <span className="text-base" aria-hidden="true">
          {STATUS_ICONS[job.status]}
        </span>
        <span className="text-sm font-medium">
          {STATUS_LABELS[job.status]}
        </span>
        {job.status === 'IN_PROGRESS' && (
          <div
            className="ml-auto w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"
            aria-hidden="true"
          />
        )}
      </div>

      {job.status === 'FAILED' && job.failureReason && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
          <p className="text-xs font-medium text-red-800 mb-1">エラー詳細</p>
          <p className="text-sm text-red-700">{job.failureReason}</p>
        </div>
      )}

      <dl className="text-xs text-gray-500 space-y-1">
        <div className="flex justify-between">
          <dt>ジョブ ID</dt>
          <dd className="font-mono text-gray-700">{job.jobId}</dd>
        </div>
        <div className="flex justify-between">
          <dt>言語</dt>
          <dd className="text-gray-700">{job.languageCode}</dd>
        </div>
        <div className="flex justify-between">
          <dt>最大話者数</dt>
          <dd className="text-gray-700">{job.maxSpeakerLabels}</dd>
        </div>
        {job.languageModelName && (
          <div className="flex justify-between">
            <dt>言語モデル</dt>
            <dd className="text-gray-700">{job.languageModelName}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
