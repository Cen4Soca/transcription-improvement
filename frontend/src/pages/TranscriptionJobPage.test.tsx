import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptionJobPage } from './TranscriptionJobPage';
import type { TranscriptionApi } from '../services/transcription-api';
import type { LanguageModelApi } from '../services/language-model-api';
import type { MediaApi } from '../services/media-api';

function createMockTranscriptionApi(overrides?: Partial<TranscriptionApi>): TranscriptionApi {
  return {
    startJob: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        jobId: 'job-123',
        transcribeJobName: 'transcribe-job-123',
        mediaFileId: 'media-1',
        status: 'IN_PROGRESS',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 2,
        startedBy: 'user-1',
        createdAt: '2024-06-01T10:00:00.000Z',
        updatedAt: '2024-06-01T10:00:00.000Z',
      },
    }),
    getJobStatus: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        jobId: 'job-123',
        transcribeJobName: 'transcribe-job-123',
        mediaFileId: 'media-1',
        status: 'IN_PROGRESS',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 2,
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

function createMockLanguageModelApi(): LanguageModelApi {
  return {
    listModels: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        models: [
          { modelName: 'custom-model-v1', modelStatus: 'COMPLETED', baseModelName: 'NarrowBand' },
        ],
      },
    }),
    createModel: vi.fn(),
    getModelStatus: vi.fn(),
  } as unknown as LanguageModelApi;
}

function createMockMediaApi(overrides?: Partial<MediaApi>): MediaApi {
  return {
    listMediaFiles: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        data: {
          mediaFiles: [
            {
              mediaFileId: 'media-1',
              filename: '会議録音.mp3',
              s3Key: 'media/media-1/会議録音.mp3',
              contentType: 'audio/mpeg',
              fileSize: 5242880,
              uploadedBy: 'user-1',
              status: 'UPLOADED',
              createdAt: '2024-06-01T10:00:00.000Z',
              updatedAt: '2024-06-01T10:00:00.000Z',
            },
          ],
        },
      },
    }),
    getUploadUrl: vi.fn(),
    uploadFileToS3: vi.fn(),
    ...overrides,
  } as unknown as MediaApi;
}

describe('TranscriptionJobPage', () => {
  let mockTranscriptionApi: TranscriptionApi;
  let mockLanguageModelApi: LanguageModelApi;
  let mockMediaApi: MediaApi;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockTranscriptionApi = createMockTranscriptionApi();
    mockLanguageModelApi = createMockLanguageModelApi();
    mockMediaApi = createMockMediaApi();
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('renders the page header', async () => {
      render(
        <TranscriptionJobPage
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaApi={mockMediaApi}
        />,
      );

      expect(screen.getByRole('main', { name: '文字起こしジョブ' })).toBeInTheDocument();
      expect(screen.getByText('文字起こしジョブ')).toBeInTheDocument();
      expect(screen.getByText(/メディアファイルから話者情報付きの文字起こしを作成します/)).toBeInTheDocument();
    });

    it('shows loading state while fetching media files', () => {
      const slowMediaApi = createMockMediaApi({
        listMediaFiles: vi.fn().mockReturnValue(new Promise(() => {})),
      });

      render(
        <TranscriptionJobPage
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaApi={slowMediaApi}
        />,
      );

      expect(screen.getByRole('status', { name: 'メディアファイル読み込み中' })).toBeInTheDocument();
    });

    it('shows the job creation form after media files are loaded', async () => {
      render(
        <TranscriptionJobPage
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaApi={mockMediaApi}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('form', { name: 'Transcription ジョブ作成フォーム' })).toBeInTheDocument();
      });
    });

    it('shows error when media file fetch fails', async () => {
      const failingMediaApi = createMockMediaApi({
        listMediaFiles: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'SERVER_ERROR', message: 'サーバーエラーが発生しました' },
        }),
      });

      render(
        <TranscriptionJobPage
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaApi={failingMediaApi}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/サーバーエラーが発生しました/)).toBeInTheDocument();
      });
    });
  });

  describe('job creation flow', () => {
    it('shows JobStatusPoller after job is started', async () => {
      render(
        <TranscriptionJobPage
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaApi={mockMediaApi}
        />,
      );

      // Wait for form to appear
      await waitFor(() => {
        expect(screen.getByRole('form', { name: 'Transcription ジョブ作成フォーム' })).toBeInTheDocument();
      });

      // Wait for models to load
      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      // Select media file and submit
      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      // Form should be hidden, poller should appear
      await waitFor(() => {
        expect(screen.queryByRole('form', { name: 'Transcription ジョブ作成フォーム' })).not.toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByLabelText('ジョブステータス')).toBeInTheDocument();
      });
    });

    it('shows "新しいジョブを作成" button when job is active', async () => {
      render(
        <TranscriptionJobPage
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaApi={mockMediaApi}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('form', { name: 'Transcription ジョブ作成フォーム' })).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '新しいジョブを作成' })).toBeInTheDocument();
      });
    });

    it('returns to form when "新しいジョブを作成" is clicked', async () => {
      render(
        <TranscriptionJobPage
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaApi={mockMediaApi}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('form', { name: 'Transcription ジョブ作成フォーム' })).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '新しいジョブを作成' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: '新しいジョブを作成' }));

      await waitFor(() => {
        expect(screen.getByRole('form', { name: 'Transcription ジョブ作成フォーム' })).toBeInTheDocument();
      });
    });

    it('shows completion message when job completes', async () => {
      const api = createMockTranscriptionApi({
        getJobStatus: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            jobId: 'job-123',
            transcribeJobName: 'transcribe-job-123',
            mediaFileId: 'media-1',
            status: 'COMPLETED',
            languageCode: 'ja-JP',
            maxSpeakerLabels: 2,
            sessionId: 'session-456',
            startedBy: 'user-1',
            createdAt: '2024-06-01T10:00:00.000Z',
            updatedAt: '2024-06-01T10:00:00.000Z',
          },
        }),
      });

      render(
        <TranscriptionJobPage
          transcriptionApi={api}
          languageModelApi={mockLanguageModelApi}
          mediaApi={mockMediaApi}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('form', { name: 'Transcription ジョブ作成フォーム' })).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(screen.getByText('文字起こしジョブが完了しました')).toBeInTheDocument();
      });

      expect(screen.getByText(/セッション ID: session-456/)).toBeInTheDocument();
    });
  });
});
