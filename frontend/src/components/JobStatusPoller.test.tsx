import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { JobStatusPoller } from './JobStatusPoller';
import type { TranscriptionApi, TranscriptionJob } from '../services/transcription-api';

function createMockTranscriptionApi(overrides?: Partial<TranscriptionApi>): TranscriptionApi {
  return {
    startJob: vi.fn(),
    getJobStatus: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        jobId: 'job-123',
        transcribeJobName: 'transcribe-job-123',
        mediaFileId: 'media-1',
        status: 'IN_PROGRESS',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 3,
        startedBy: 'user-1',
        createdAt: '2024-06-01T10:00:00.000Z',
        updatedAt: '2024-06-01T10:00:00.000Z',
      },
    }),
    downloadJson: vi.fn(),
    downloadSrt: vi.fn(),
    ...overrides,
  } as unknown as TranscriptionApi;
}

const baseJob: TranscriptionJob = {
  jobId: 'job-123',
  transcribeJobName: 'transcribe-job-123',
  mediaFileId: 'media-1',
  status: 'IN_PROGRESS',
  languageCode: 'ja-JP',
  maxSpeakerLabels: 3,
  startedBy: 'user-1',
  createdAt: '2024-06-01T10:00:00.000Z',
  updatedAt: '2024-06-01T10:00:00.000Z',
};

describe('JobStatusPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state initially', () => {
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    expect(screen.getByRole('status', { name: 'ジョブステータス読み込み中' })).toBeInTheDocument();
    expect(screen.getByText('ジョブ情報を取得中...')).toBeInTheDocument();
  });

  it('fetches job status immediately on mount', async () => {
    const api = createMockTranscriptionApi();

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledWith('job-123');
    });
  });

  it('displays IN_PROGRESS status with polling indicator', async () => {
    const api = createMockTranscriptionApi();

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(screen.getByText('処理中')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('ポーリング中')).toBeInTheDocument();
    expect(screen.getByText('自動更新中')).toBeInTheDocument();
  });

  it('displays COMPLETED status and stops polling', async () => {
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockResolvedValue({
        ok: true,
        value: { ...baseJob, status: 'COMPLETED' },
      }),
    });

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(screen.getByText('完了')).toBeInTheDocument();
    });

    expect(screen.queryByText('自動更新中')).not.toBeInTheDocument();
  });

  it('displays FAILED status with failure reason', async () => {
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ...baseJob,
          status: 'FAILED',
          failureReason: 'メディアファイルの形式がサポートされていません。',
        },
      }),
    });

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(screen.getByText('失敗')).toBeInTheDocument();
    });

    expect(screen.getByText('エラー詳細')).toBeInTheDocument();
    expect(screen.getByText('メディアファイルの形式がサポートされていません。')).toBeInTheDocument();
  });

  it('displays API error when fetch fails', async () => {
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'ネットワークに接続できません。' },
      }),
    });

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/ネットワークに接続できません。/)).toBeInTheDocument();
    });
  });

  it('polls at 5 second intervals by default', async () => {
    const api = createMockTranscriptionApi();

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    // Initial fetch
    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(1);
    });

    // Advance 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(2);
    });

    // Advance another 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(3);
    });
  });

  it('stops polling when COMPLETED status is reached', async () => {
    let callCount = 0;
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) {
          return { ok: true, value: { ...baseJob, status: 'COMPLETED' } };
        }
        return { ok: true, value: { ...baseJob, status: 'IN_PROGRESS' } };
      }),
    });

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    // Initial fetch (IN_PROGRESS)
    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(1);
    });

    // Advance to trigger second poll (COMPLETED)
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(screen.getByText('完了')).toBeInTheDocument();
    });

    // Advance more - should not poll again
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(api.getJobStatus).toHaveBeenCalledTimes(2);
  });

  it('stops polling when FAILED status is reached', async () => {
    let callCount = 0;
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) {
          return {
            ok: true,
            value: { ...baseJob, status: 'FAILED', failureReason: 'Error occurred' },
          };
        }
        return { ok: true, value: { ...baseJob, status: 'IN_PROGRESS' } };
      }),
    });

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(screen.getByText('失敗')).toBeInTheDocument();
    });

    // Should not poll again
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(api.getJobStatus).toHaveBeenCalledTimes(2);
  });

  it('calls onCompleted callback when job completes', async () => {
    const completedJob = { ...baseJob, status: 'COMPLETED' as const };
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockResolvedValue({ ok: true, value: completedJob }),
    });
    const onCompleted = vi.fn();

    render(
      <JobStatusPoller jobId="job-123" transcriptionApi={api} onCompleted={onCompleted} />,
    );

    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledWith(completedJob);
    });
  });

  it('calls onFailed callback when job fails', async () => {
    const failedJob = { ...baseJob, status: 'FAILED' as const, failureReason: 'Error' };
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockResolvedValue({ ok: true, value: failedJob }),
    });
    const onFailed = vi.fn();

    render(
      <JobStatusPoller jobId="job-123" transcriptionApi={api} onFailed={onFailed} />,
    );

    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledWith(failedJob);
    });
  });

  it('calls onStatusChange callback on each status update', async () => {
    const api = createMockTranscriptionApi();
    const onStatusChange = vi.fn();

    render(
      <JobStatusPoller jobId="job-123" transcriptionApi={api} onStatusChange={onStatusChange} />,
    );

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-123' }));
    });
  });

  it('displays job details (jobId, language, maxSpeakerLabels)', async () => {
    const api = createMockTranscriptionApi();

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(screen.getByText('job-123')).toBeInTheDocument();
    });

    expect(screen.getByText('ja-JP')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('displays language model name when present', async () => {
    const api = createMockTranscriptionApi({
      getJobStatus: vi.fn().mockResolvedValue({
        ok: true,
        value: { ...baseJob, languageModelName: 'custom-model-v1' },
      }),
    });

    render(<JobStatusPoller jobId="job-123" transcriptionApi={api} />);

    await waitFor(() => {
      expect(screen.getByText('言語モデル')).toBeInTheDocument();
      expect(screen.getByText('custom-model-v1')).toBeInTheDocument();
    });
  });

  it('supports custom polling interval', async () => {
    const api = createMockTranscriptionApi();

    render(
      <JobStatusPoller jobId="job-123" transcriptionApi={api} pollingIntervalMs={2000} />,
    );

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(1);
    });

    // Advance 2 seconds (custom interval)
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(2);
    });
  });

  it('cleans up interval on unmount', async () => {
    const api = createMockTranscriptionApi();

    const { unmount } = render(
      <JobStatusPoller jobId="job-123" transcriptionApi={api} />,
    );

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledTimes(1);
    });

    unmount();

    // Advance time - should not call again
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(api.getJobStatus).toHaveBeenCalledTimes(1);
  });
});
