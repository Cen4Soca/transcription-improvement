import { useState, useEffect, useCallback } from 'react';
import { TranscriptionJobForm } from '../components/TranscriptionJobForm';
import { JobStatusPoller } from '../components/JobStatusPoller';
import type { TranscriptionApi } from '../services/transcription-api';
import type { TranscriptionJob } from '../services/transcription-api';
import type { LanguageModelApi } from '../services/language-model-api';
import type { MediaApi, MediaFile } from '../services/media-api';

export interface TranscriptionJobPageProps {
  transcriptionApi: TranscriptionApi;
  languageModelApi: LanguageModelApi;
  mediaApi: MediaApi;
}

/**
 * TranscriptionJobPage - Transcription ジョブ作成・ステータス管理ページ
 *
 * - メディアファイル一覧を取得してフォームに渡す
 * - ジョブ作成フォーム（MaxSpeakerLabels・言語コード・カスタムモデル選択）
 * - ジョブ開始後に JobStatusPoller でステータスをポーリング表示
 * - エラーメッセージ表示（メディアファイル取得失敗時）
 *
 * Requirements: 17.3, 17.4, 17.5, 17.6, 17.9, 17.10, 18.1, 18.2, 18.3, 18.4, 18.5
 */
export function TranscriptionJobPage({
  transcriptionApi,
  languageModelApi,
  mediaApi,
}: TranscriptionJobPageProps) {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [completedJob, setCompletedJob] = useState<TranscriptionJob | null>(null);

  // Fetch media files on mount
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
  }, [mediaApi]);

  const handleJobStarted = useCallback((jobId: string) => {
    setActiveJobId(jobId);
    setCompletedJob(null);
  }, []);

  const handleJobCompleted = useCallback((job: TranscriptionJob) => {
    setCompletedJob(job);
  }, []);

  const handleStartNewJob = useCallback(() => {
    setActiveJobId(null);
    setCompletedJob(null);
  }, []);

  return (
    <div className="flex flex-col h-full" role="main" aria-label="文字起こしジョブ">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">文字起こしジョブ</h1>
        <p className="mt-1 text-sm text-gray-500">
          メディアファイルから話者情報付きの文字起こしを作成します
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Media loading error */}
          {mediaError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
              <p className="text-sm text-red-700">
                メディアファイルの取得に失敗しました: {mediaError}
              </p>
            </div>
          )}

          {/* Media loading state */}
          {isLoadingMedia && (
            <div className="flex items-center justify-center p-6" role="status" aria-label="メディアファイル読み込み中">
              <div className="w-5 h-5 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              <span className="ml-2 text-sm text-gray-500">メディアファイルを読み込み中...</span>
            </div>
          )}

          {/* Job creation form (shown when no active job) */}
          {!isLoadingMedia && !activeJobId && (
            <TranscriptionJobForm
              transcriptionApi={transcriptionApi}
              languageModelApi={languageModelApi}
              mediaFiles={mediaFiles}
              onJobStarted={handleJobStarted}
            />
          )}

          {/* Job status poller (shown when job is active) */}
          {activeJobId && (
            <div className="space-y-4">
              <JobStatusPoller
                jobId={activeJobId}
                transcriptionApi={transcriptionApi}
                onCompleted={handleJobCompleted}
              />

              {/* Completed message with action */}
              {completedJob && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4" role="status" aria-live="polite">
                  <p className="text-sm font-medium text-green-700">
                    文字起こしジョブが完了しました
                  </p>
                  {completedJob.sessionId && (
                    <p className="text-xs text-green-600 mt-1">
                      セッション ID: {completedJob.sessionId}
                    </p>
                  )}
                </div>
              )}

              {/* Start new job button */}
              <button
                type="button"
                onClick={handleStartNewJob}
                className="w-full px-4 py-2.5 bg-white text-gray-700 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                新しいジョブを作成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
