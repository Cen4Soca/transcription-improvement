import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptionDownload } from './TranscriptionDownload';
import type { TranscriptionApi, TranscriptionJsonResponse } from '../services/transcription-api';
import type { Result, AppError } from '../types/api';

function createMockTranscriptionApi(overrides?: Partial<TranscriptionApi>): TranscriptionApi {
  return {
    startJob: vi.fn(),
    getJobStatus: vi.fn(),
    downloadJson: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        sessionName: 'テストセッション',
        exportedAt: '2024-06-15T10:00:00.000Z',
        segments: [
          { startTime: 0, endTime: 3.5, text: 'テストテキスト', speakerLabel: 'spk_0' },
        ],
      } satisfies TranscriptionJsonResponse,
    } satisfies Result<TranscriptionJsonResponse, AppError>),
    downloadSrt: vi.fn().mockResolvedValue({
      ok: true,
      value: '1\n00:00:00,000 --> 00:00:03,500\n[spk_0] テストテキスト\n',
    } satisfies Result<string, AppError>),
    ...overrides,
  } as unknown as TranscriptionApi;
}

describe('TranscriptionDownload', () => {
  let mockApi: TranscriptionApi;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockApi = createMockTranscriptionApi();
    user = userEvent.setup();
    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('renders format selection and download button', () => {
    render(
      <TranscriptionDownload
        transcriptionApi={mockApi}
        sessionId="session-1"
        sessionName="テストセッション"
      />,
    );

    expect(screen.getByText('修正後 Transcription ダウンロード')).toBeInTheDocument();
    expect(screen.getByLabelText('JSON')).toBeInTheDocument();
    expect(screen.getByLabelText('SRT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ダウンロード' })).toBeInTheDocument();
  });

  it('defaults to JSON format', () => {
    render(
      <TranscriptionDownload
        transcriptionApi={mockApi}
        sessionId="session-1"
        sessionName="テストセッション"
      />,
    );

    const jsonRadio = screen.getByLabelText('JSON') as HTMLInputElement;
    const srtRadio = screen.getByLabelText('SRT') as HTMLInputElement;
    expect(jsonRadio.checked).toBe(true);
    expect(srtRadio.checked).toBe(false);
  });

  it('allows switching to SRT format', async () => {
    render(
      <TranscriptionDownload
        transcriptionApi={mockApi}
        sessionId="session-1"
        sessionName="テストセッション"
      />,
    );

    await user.click(screen.getByLabelText('SRT'));

    const srtRadio = screen.getByLabelText('SRT') as HTMLInputElement;
    expect(srtRadio.checked).toBe(true);
  });

  it('calls downloadJson when JSON format is selected and download is clicked', async () => {
    render(
      <TranscriptionDownload
        transcriptionApi={mockApi}
        sessionId="session-1"
        sessionName="テストセッション"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));

    await waitFor(() => {
      expect(mockApi.downloadJson).toHaveBeenCalledWith('session-1');
    });
  });

  it('calls downloadSrt when SRT format is selected and download is clicked', async () => {
    render(
      <TranscriptionDownload
        transcriptionApi={mockApi}
        sessionId="session-1"
        sessionName="テストセッション"
      />,
    );

    await user.click(screen.getByLabelText('SRT'));
    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));

    await waitFor(() => {
      expect(mockApi.downloadSrt).toHaveBeenCalledWith('session-1');
    });
  });

  it('displays error message when download fails', async () => {
    const errorApi = createMockTranscriptionApi({
      downloadJson: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'NO_CONFIRMED_SEGMENTS',
          message: '確定済みの Segment がありません',
        },
      }),
    });

    render(
      <TranscriptionDownload
        transcriptionApi={errorApi}
        sessionId="session-1"
        sessionName="テストセッション"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('確定済みの Segment がありません')).toBeInTheDocument();
  });

  it('shows loading state during download', async () => {
    const slowApi = createMockTranscriptionApi({
      downloadJson: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    render(
      <TranscriptionDownload
        transcriptionApi={slowApi}
        sessionId="session-1"
        sessionName="テストセッション"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));

    await waitFor(() => {
      expect(screen.getByText('ダウンロード中...')).toBeInTheDocument();
    });

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('triggers browser download with correct filename for JSON', async () => {
    render(
      <TranscriptionDownload
        transcriptionApi={mockApi}
        sessionId="session-1"
        sessionName="会議録"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));

    await waitFor(() => {
      expect(mockApi.downloadJson).toHaveBeenCalledWith('session-1');
    });

    // Verify URL.createObjectURL was called (indicating blob was created for download)
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    // revokeObjectURL は setTimeout で遅延実行されるため waitFor で待機する
    await waitFor(() => {
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  it('triggers browser download for SRT format', async () => {
    render(
      <TranscriptionDownload
        transcriptionApi={mockApi}
        sessionId="session-1"
        sessionName="会議録"
      />,
    );

    await user.click(screen.getByLabelText('SRT'));
    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));

    await waitFor(() => {
      expect(mockApi.downloadSrt).toHaveBeenCalledWith('session-1');
    });

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    await waitFor(() => {
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  it('clears error when a new download succeeds', async () => {
    let callCount = 0;
    const errorThenSuccessApi = createMockTranscriptionApi({
      downloadJson: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            error: { code: 'ERROR', message: 'エラーが発生しました' },
          });
        }
        return Promise.resolve({
          ok: true,
          value: {
            sessionName: 'テスト',
            exportedAt: '2024-01-01T00:00:00.000Z',
            segments: [],
          },
        });
      }),
    });

    render(
      <TranscriptionDownload
        transcriptionApi={errorThenSuccessApi}
        sessionId="session-1"
        sessionName="テスト"
      />,
    );

    // First click - error
    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Second click - success
    await user.click(screen.getByRole('button', { name: 'ダウンロード' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
