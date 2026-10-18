import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TranscriptionJobStatusInner } from './TranscriptionJobStatus';
import type { UseTranscriptionJobReturn } from '../hooks/useTranscriptionJob';
import type { TranscriptionJob } from '../services/transcription-api';

function createMockHook(overrides: Partial<UseTranscriptionJobReturn> = {}): UseTranscriptionJobReturn {
  return {
    job: null,
    isPolling: false,
    error: null,
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    fetchStatus: vi.fn(),
    ...overrides,
  };
}

const baseJob: TranscriptionJob = {
  jobId: 'job-123',
  transcribeJobName: 'transcribe-job-123',
  mediaFileId: 'media-456',
  status: 'IN_PROGRESS',
  languageCode: 'ja-JP',
  maxSpeakerLabels: 3,
  startedBy: 'user-1',
  createdAt: '2024-06-01T10:00:00.000Z',
  updatedAt: '2024-06-01T10:00:00.000Z',
};

describe('TranscriptionJobStatus', () => {
  let mockHook: UseTranscriptionJobReturn;

  beforeEach(() => {
    mockHook = createMockHook();
  });

  it('shows loading state when job is null', () => {
    render(<TranscriptionJobStatusInner jobId="job-123" hook={mockHook} />);
    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    expect(screen.getByText('ジョブ情報を取得中...')).toBeInTheDocument();
  });

  it('starts polling on mount with the given jobId', () => {
    render(<TranscriptionJobStatusInner jobId="job-123" hook={mockHook} />);
    expect(mockHook.startPolling).toHaveBeenCalledWith('job-123');
  });

  it('stops polling on unmount', () => {
    const { unmount } = render(<TranscriptionJobStatusInner jobId="job-123" hook={mockHook} />);
    unmount();
    expect(mockHook.stopPolling).toHaveBeenCalled();
  });

  it('displays IN_PROGRESS status correctly', () => {
    const hook = createMockHook({
      job: { ...baseJob, status: 'IN_PROGRESS' },
      isPolling: true,
    });

    render(<TranscriptionJobStatusInner jobId="job-123" hook={hook} />);

    expect(screen.getByText('処理中')).toBeInTheDocument();
    expect(screen.getByText('自動更新中...')).toBeInTheDocument();
  });

  it('displays COMPLETED status correctly', () => {
    const hook = createMockHook({
      job: { ...baseJob, status: 'COMPLETED' },
      isPolling: false,
    });

    render(<TranscriptionJobStatusInner jobId="job-123" hook={hook} />);

    expect(screen.getByText('完了')).toBeInTheDocument();
    expect(screen.queryByText('自動更新中...')).not.toBeInTheDocument();
  });

  it('displays FAILED status with error message', () => {
    const hook = createMockHook({
      job: {
        ...baseJob,
        status: 'FAILED',
        failureReason: 'メディアファイルの形式がサポートされていません。',
      },
      isPolling: false,
    });

    render(<TranscriptionJobStatusInner jobId="job-123" hook={hook} />);

    expect(screen.getByText('失敗')).toBeInTheDocument();
    expect(screen.getByText('エラー詳細')).toBeInTheDocument();
    expect(screen.getByText('メディアファイルの形式がサポートされていません。')).toBeInTheDocument();
  });

  it('displays API error when hook returns error', () => {
    const hook = createMockHook({
      error: {
        code: 'NETWORK_ERROR',
        message: 'ネットワークに接続できません。',
      },
    });

    render(<TranscriptionJobStatusInner jobId="job-123" hook={hook} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/ネットワークに接続できません。/)).toBeInTheDocument();
  });

  it('displays job details (jobId, language, maxSpeakerLabels)', () => {
    const hook = createMockHook({
      job: { ...baseJob, status: 'IN_PROGRESS' },
    });

    render(<TranscriptionJobStatusInner jobId="job-123" hook={hook} />);

    expect(screen.getByText('job-123')).toBeInTheDocument();
    expect(screen.getByText('ja-JP')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('displays language model name when present', () => {
    const hook = createMockHook({
      job: { ...baseJob, languageModelName: 'custom-model-v1' },
    });

    render(<TranscriptionJobStatusInner jobId="job-123" hook={hook} />);

    expect(screen.getByText('言語モデル')).toBeInTheDocument();
    expect(screen.getByText('custom-model-v1')).toBeInTheDocument();
  });

  it('does not display language model section when not present', () => {
    const hook = createMockHook({
      job: { ...baseJob },
    });

    render(<TranscriptionJobStatusInner jobId="job-123" hook={hook} />);

    expect(screen.queryByText('言語モデル')).not.toBeInTheDocument();
  });
});
