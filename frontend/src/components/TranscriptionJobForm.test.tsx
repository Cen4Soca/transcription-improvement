import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TranscriptionJobForm } from './TranscriptionJobForm';
import type { TranscriptionApi } from '../services/transcription-api';
import type { LanguageModelApi, LanguageModelListResponse } from '../services/language-model-api';
import type { MediaFile } from '../services/media-api';
import type { Result, AppError } from '../types/api';

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
    getJobStatus: vi.fn(),
    downloadJson: vi.fn(),
    downloadSrt: vi.fn(),
    ...overrides,
  } as unknown as TranscriptionApi;
}

function createMockLanguageModelApi(
  response?: Result<LanguageModelListResponse, AppError>,
): LanguageModelApi {
  return {
    listModels: vi.fn().mockResolvedValue(
      response ?? {
        ok: true,
        value: {
          models: [
            { modelName: 'custom-model-v1', modelStatus: 'COMPLETED', baseModelName: 'NarrowBand', displayName: '営業ドメイン v1', teamId: 'team-1' },
            { modelName: 'custom-model-v2', modelStatus: 'COMPLETED', baseModelName: 'WideBand', displayName: '医療ドメイン v2', teamId: 'team-1' },
          ],
        },
      },
    ),
    createModel: vi.fn(),
    getModelStatus: vi.fn(),
  } as unknown as LanguageModelApi;
}

const mockMediaFiles: MediaFile[] = [
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
  {
    mediaFileId: 'media-2',
    filename: 'インタビュー.wav',
    s3Key: 'media/media-2/インタビュー.wav',
    contentType: 'audio/wav',
    fileSize: 104857600,
    uploadedBy: 'user-2',
    status: 'COMPLETED',
    createdAt: '2024-06-02T14:30:00.000Z',
    updatedAt: '2024-06-02T14:30:00.000Z',
  },
  {
    mediaFileId: 'media-3',
    filename: '処理中ファイル.mp3',
    s3Key: 'media/media-3/処理中ファイル.mp3',
    contentType: 'audio/mpeg',
    fileSize: 1024,
    uploadedBy: 'user-1',
    status: 'PROCESSING',
    createdAt: '2024-06-03T09:00:00.000Z',
    updatedAt: '2024-06-03T09:00:00.000Z',
  },
];

describe('TranscriptionJobForm', () => {
  let mockTranscriptionApi: TranscriptionApi;
  let mockLanguageModelApi: LanguageModelApi;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockTranscriptionApi = createMockTranscriptionApi();
    mockLanguageModelApi = createMockLanguageModelApi();
    user = userEvent.setup();
  });

  describe('rendering', () => {
    it('renders the form with all required fields', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      expect(screen.getByRole('form', { name: 'Transcription ジョブ作成フォーム' })).toBeInTheDocument();
      expect(screen.getByText('文字起こしジョブ作成')).toBeInTheDocument();
      expect(screen.getByLabelText(/メディアファイル/)).toBeInTheDocument();
      expect(screen.getByLabelText(/最大話者数/)).toBeInTheDocument();
      expect(screen.getByLabelText(/言語/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '文字起こしジョブを開始' })).toBeInTheDocument();
    });

    it('only shows UPLOADED and COMPLETED media files in the select', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      const select = screen.getByLabelText(/メディアファイル/) as HTMLSelectElement;
      const options = Array.from(select.options);

      // Placeholder + 2 valid files (UPLOADED and COMPLETED)
      expect(options).toHaveLength(3);
      expect(options[1].textContent).toBe('会議録音.mp3');
      expect(options[2].textContent).toBe('インタビュー.wav');
    });

    it('defaults MaxSpeakerLabels to 2', () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      const input = screen.getByLabelText(/最大話者数/) as HTMLInputElement;
      expect(input.value).toBe('2');
    });

    it('defaults language code to ja-JP', () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      const select = screen.getByLabelText(/言語/) as HTMLSelectElement;
      expect(select.value).toBe('ja-JP');
    });
  });

  describe('language model selection', () => {
    it('shows available language models after loading', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/カスタム言語モデル/)).toBeInTheDocument();
      });

      const modelSelect = screen.getByLabelText(/カスタム言語モデル/) as HTMLSelectElement;
      const options = Array.from(modelSelect.options);
      expect(options[0].textContent).toBe('モデルを使用しない');
      // Option label is the human-readable displayName...
      expect(options[1].textContent).toBe('営業ドメイン v1');
      expect(options[2].textContent).toBe('医療ドメイン v2');
      // ...while the submitted value stays the Transcribe modelName.
      expect(options[1].value).toBe('custom-model-v1');
      expect(options[2].value).toBe('custom-model-v2');
    });

    it('falls back to modelName as the label when displayName is absent', async () => {
      const noDisplayNameApi = createMockLanguageModelApi({
        ok: true,
        value: {
          models: [{ modelName: 'legacy-model', modelStatus: 'COMPLETED' }],
        },
      });

      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={noDisplayNameApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/カスタム言語モデル/)).toBeInTheDocument();
      });

      const modelSelect = screen.getByLabelText(/カスタム言語モデル/) as HTMLSelectElement;
      const options = Array.from(modelSelect.options);
      expect(options[1].textContent).toBe('legacy-model');
      expect(options[1].value).toBe('legacy-model');
    });

    it('shows "利用可能なモデルなし" when no models are available', async () => {
      const emptyModelApi = createMockLanguageModelApi({
        ok: true,
        value: { models: [] },
      });

      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={emptyModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('利用可能なモデルなし')).toBeInTheDocument();
      });
    });
  });

  describe('validation', () => {
    it('shows error when submitting without selecting a media file', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      expect(screen.getByText('メディアファイルを選択してください')).toBeInTheDocument();
    });

    it('shows error when MaxSpeakerLabels is below 2', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      // Select a media file first
      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');

      // Set invalid speaker count
      const speakerInput = screen.getByLabelText(/最大話者数/);
      await user.clear(speakerInput);
      await user.type(speakerInput, '1');

      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      expect(screen.getByText('話者数は2〜10の範囲で指定してください')).toBeInTheDocument();
    });

    it('shows error when MaxSpeakerLabels exceeds 10', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');

      const speakerInput = screen.getByLabelText(/最大話者数/);
      await user.clear(speakerInput);
      await user.type(speakerInput, '11');

      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      expect(screen.getByText('話者数は2〜10の範囲で指定してください')).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('calls startJob with correct parameters on valid submission', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');

      const speakerInput = screen.getByLabelText(/最大話者数/);
      await user.clear(speakerInput);
      await user.type(speakerInput, '5');

      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(mockTranscriptionApi.startJob).toHaveBeenCalledWith({
          mediaFileId: 'media-1',
          maxSpeakerLabels: 5,
          languageCode: 'ja-JP',
        });
      });
    });

    it('includes languageModelName when a model is selected', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/カスタム言語モデル/)).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.selectOptions(screen.getByLabelText(/カスタム言語モデル/), 'custom-model-v1');

      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(mockTranscriptionApi.startJob).toHaveBeenCalledWith({
          mediaFileId: 'media-1',
          maxSpeakerLabels: 2,
          languageCode: 'ja-JP',
          languageModelName: 'custom-model-v1',
        });
      });
    });

    it('calls onJobStarted callback with jobId on success', async () => {
      const onJobStarted = vi.fn();

      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
          onJobStarted={onJobStarted}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(onJobStarted).toHaveBeenCalledWith('job-123');
      });
    });

    it('shows error message when API call fails', async () => {
      const failingApi = createMockTranscriptionApi({
        startJob: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'SERVER_ERROR', message: 'ジョブの開始に失敗しました' },
        }),
      });

      render(
        <TranscriptionJobForm
          transcriptionApi={failingApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('ジョブの開始に失敗しました')).toBeInTheDocument();
      });
    });

    it('shows submitting state during API call', async () => {
      const slowApi = createMockTranscriptionApi({
        startJob: vi.fn().mockReturnValue(new Promise(() => {})),
      });

      render(
        <TranscriptionJobForm
          transcriptionApi={slowApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText('モデル一覧を読み込み中...')).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(/メディアファイル/), 'media-1');
      await user.click(screen.getByRole('button', { name: '文字起こしジョブを開始' }));

      await waitFor(() => {
        expect(screen.getByText('作成中...')).toBeInTheDocument();
      });
    });
  });

  describe('accessibility', () => {
    it('has no axe violations once models are loaded', async () => {
      const { container } = render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/カスタム言語モデル/)).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
