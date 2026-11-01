import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TranscriptionJobForm } from './TranscriptionJobForm';
import type { TranscriptionApi } from '../services/transcription-api';
import type { LanguageModelApi, LanguageModelListResponse } from '../services/language-model-api';
import type { MediaFile } from '../services/media-api';
import type { Result, AppError } from '../types/api';
import i18n from '../i18n';

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(`transcriptionJob:${key}`, vars);
// Labels are rendered via i18n; match them by current translation to stay language-agnostic.
const re = (key: string) => new RegExp(i18n.t(`transcriptionJob:${key}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const submitName = () => i18n.t('transcriptionJob:form.submit');
const loadingModelsText = () => i18n.t('transcriptionJob:form.loadingModels');

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

      expect(screen.getByRole('form', { name: t('form.formAriaLabel') })).toBeInTheDocument();
      expect(screen.getByText(t('form.title'))).toBeInTheDocument();
      expect(screen.getByLabelText(re('form.mediaFile'))).toBeInTheDocument();
      expect(screen.getByLabelText(re('form.maxSpeakers'))).toBeInTheDocument();
      expect(screen.getByLabelText(re('form.language'))).toBeInTheDocument();
      expect(screen.getByRole('button', { name: submitName() })).toBeInTheDocument();
    });

    it('only shows UPLOADED and COMPLETED media files in the select', async () => {
      render(
        <TranscriptionJobForm
          transcriptionApi={mockTranscriptionApi}
          languageModelApi={mockLanguageModelApi}
          mediaFiles={mockMediaFiles}
        />,
      );

      const select = screen.getByLabelText(re('form.mediaFile')) as HTMLSelectElement;
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

      const input = screen.getByLabelText(re('form.maxSpeakers')) as HTMLInputElement;
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

      const select = screen.getByLabelText(re('form.language')) as HTMLSelectElement;
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
        expect(screen.getByLabelText(re('form.customLanguageModel'))).toBeInTheDocument();
      });

      const modelSelect = screen.getByLabelText(re('form.customLanguageModel')) as HTMLSelectElement;
      const options = Array.from(modelSelect.options);
      expect(options[0].textContent).toBe(t('form.noModel'));
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
        expect(screen.getByLabelText(re('form.customLanguageModel'))).toBeInTheDocument();
      });

      const modelSelect = screen.getByLabelText(re('form.customLanguageModel')) as HTMLSelectElement;
      const options = Array.from(modelSelect.options);
      expect(options[1].textContent).toBe('legacy-model');
      expect(options[1].value).toBe('legacy-model');
    });

    it('shows the no-models message when no models are available', async () => {
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
        expect(screen.getByText(t('form.noAvailableModels'))).toBeInTheDocument();
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
        expect(screen.queryByText(loadingModelsText())).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: submitName() }));

      expect(screen.getByText(t('form.mediaFileRequired'))).toBeInTheDocument();
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
        expect(screen.queryByText(loadingModelsText())).not.toBeInTheDocument();
      });

      // Select a media file first
      await user.selectOptions(screen.getByLabelText(re('form.mediaFile')), 'media-1');

      // Set invalid speaker count
      const speakerInput = screen.getByLabelText(re('form.maxSpeakers'));
      await user.clear(speakerInput);
      await user.type(speakerInput, '1');

      await user.click(screen.getByRole('button', { name: submitName() }));

      expect(screen.getByText(t('form.speakerCountRange', { min: 2, max: 10 }))).toBeInTheDocument();
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
        expect(screen.queryByText(loadingModelsText())).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(re('form.mediaFile')), 'media-1');

      const speakerInput = screen.getByLabelText(re('form.maxSpeakers'));
      await user.clear(speakerInput);
      await user.type(speakerInput, '11');

      await user.click(screen.getByRole('button', { name: submitName() }));

      expect(screen.getByText(t('form.speakerCountRange', { min: 2, max: 10 }))).toBeInTheDocument();
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
        expect(screen.queryByText(loadingModelsText())).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(re('form.mediaFile')), 'media-1');

      const speakerInput = screen.getByLabelText(re('form.maxSpeakers'));
      await user.clear(speakerInput);
      await user.type(speakerInput, '5');

      await user.click(screen.getByRole('button', { name: submitName() }));

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
        expect(screen.getByLabelText(re('form.customLanguageModel'))).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(re('form.mediaFile')), 'media-1');
      await user.selectOptions(screen.getByLabelText(re('form.customLanguageModel')), 'custom-model-v1');

      await user.click(screen.getByRole('button', { name: submitName() }));

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
        expect(screen.queryByText(loadingModelsText())).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(re('form.mediaFile')), 'media-1');
      await user.click(screen.getByRole('button', { name: submitName() }));

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
        expect(screen.queryByText(loadingModelsText())).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(re('form.mediaFile')), 'media-1');
      await user.click(screen.getByRole('button', { name: submitName() }));

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
        expect(screen.queryByText(loadingModelsText())).not.toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText(re('form.mediaFile')), 'media-1');
      await user.click(screen.getByRole('button', { name: submitName() }));

      await waitFor(() => {
        expect(screen.getByText(t('form.submitting'))).toBeInTheDocument();
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
        expect(screen.getByLabelText(re('form.customLanguageModel'))).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
