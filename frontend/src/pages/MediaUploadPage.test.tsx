import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MediaUploadPage } from './MediaUploadPage';
import { checkA11y } from '../test-utils/axe-setup';
import type { MediaApi } from '../services/media-api';

function createMockMediaApi(overrides: Partial<MediaApi> = {}): MediaApi {
  return {
    getUploadUrl: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        presignedUrl: 'https://s3.example.com/upload?signed=true',
        mediaFileId: 'media-123',
        s3Key: 'media/media-123/test.mp3',
        expiresAt: '2024-06-15T11:30:00.000Z',
      },
    }),
    uploadFileToS3: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    listMediaFiles: vi.fn().mockResolvedValue({ ok: true, value: { data: { mediaFiles: [] } } }),
    ...overrides,
  } as unknown as MediaApi;
}

function createFile(name: string, size: number, type = 'audio/mpeg'): File {
  const content = new ArrayBuffer(Math.min(size, 1024));
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('MediaUploadPage', () => {
  let mockApi: MediaApi;

  beforeEach(() => {
    mockApi = createMockMediaApi();
  });

  describe('rendering', () => {
    it('renders the page header and drop zone', () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      expect(screen.getByRole('main', { name: 'メディアアップロード' })).toBeInTheDocument();
      expect(screen.getByText('メディアアップロード')).toBeInTheDocument();
      expect(screen.getByText(/ファイルを選択/)).toBeInTheDocument();
      expect(screen.getByText(/ドラッグ＆ドロップ/)).toBeInTheDocument();
    });

    it('displays supported formats information', () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      expect(screen.getByText('対応ファイル形式')).toBeInTheDocument();
      expect(screen.getByText('音声')).toBeInTheDocument();
      expect(screen.getByText('動画')).toBeInTheDocument();
      expect(screen.getByText(/最大ファイルサイズ: 2GB/)).toBeInTheDocument();
    });

    it('renders upload button as disabled when no file is selected', () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      const uploadButton = screen.getByRole('button', { name: 'アップロード開始' });
      expect(uploadButton).toBeDisabled();
    });
  });

  describe('file selection', () => {
    it('shows selected file info after choosing a valid file', async () => {
      const user = userEvent.setup();
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('recording.mp3', 1024 * 1024, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);

      expect(screen.getByText('recording.mp3')).toBeInTheDocument();
      expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    });

    it('enables upload button after selecting a valid file', async () => {
      const user = userEvent.setup();
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('recording.wav', 5000, 'audio/wav');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);

      const uploadButton = screen.getByRole('button', { name: 'アップロード開始' });
      expect(uploadButton).not.toBeDisabled();
    });
  });

  describe('client-side validation', () => {
    it('shows error for unsupported file format', async () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('document.pdf', 1024, 'application/pdf');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      // Use fireEvent to bypass the accept attribute filtering
      fireEvent.change(input, { target: { files: [file] } });

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/サポートされていないファイル形式です/)).toBeInTheDocument();
    });

    it('shows error for file exceeding 2GB', async () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      const oversizedFile = createFile('large.mp3', 2.5 * 1024 * 1024 * 1024, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      // Use fireEvent to bypass accept attribute
      fireEvent.change(input, { target: { files: [oversizedFile] } });

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/ファイルサイズが上限（2GB）を超えています/)).toBeInTheDocument();
    });

    it('accepts all supported audio formats', async () => {
      const user = userEvent.setup();
      const audioFormats = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'amr', 'webm'];

      for (const ext of audioFormats) {
        const { unmount } = render(<MediaUploadPage mediaApi={mockApi} />);
        const file = createFile(`test.${ext}`, 1024);
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await user.upload(input, file);

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText(`test.${ext}`)).toBeInTheDocument();
        unmount();
      }
    });

    it('accepts all supported video formats', async () => {
      const user = userEvent.setup();
      const videoFormats = ['mp4', 'mkv', 'avi', 'mov'];

      for (const ext of videoFormats) {
        const { unmount } = render(<MediaUploadPage mediaApi={mockApi} />);
        const file = createFile(`video.${ext}`, 1024);
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await user.upload(input, file);

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText(`video.${ext}`)).toBeInTheDocument();
        unmount();
      }
    });

    it('accepts file exactly at 2GB limit', async () => {
      const user = userEvent.setup();
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('max.mp3', 2 * 1024 * 1024 * 1024, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('max.mp3')).toBeInTheDocument();
    });
  });

  describe('upload flow', () => {
    it('calls getUploadUrl with correct parameters', async () => {
      const user = userEvent.setup();
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        expect(mockApi.getUploadUrl).toHaveBeenCalledWith({
          filename: 'recording.mp3',
          contentType: 'audio/mpeg',
          fileSize: 2048,
        });
      });
    });

    it('calls uploadFileToS3 with presigned URL and file', async () => {
      const user = userEvent.setup();
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        expect(mockApi.uploadFileToS3).toHaveBeenCalledWith(
          'https://s3.example.com/upload?signed=true',
          file,
          expect.any(Function),
        );
      });
    });

    it('shows success message after upload completes', async () => {
      const user = userEvent.setup();
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        expect(screen.getByText('アップロードが完了しました')).toBeInTheDocument();
        expect(screen.getByText(/media-123/)).toBeInTheDocument();
      });
    });

    it('calls onUploadComplete callback with mediaFileId', async () => {
      const user = userEvent.setup();
      const onUploadComplete = vi.fn();
      render(<MediaUploadPage mediaApi={mockApi} onUploadComplete={onUploadComplete} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        expect(onUploadComplete).toHaveBeenCalledWith('media-123');
      });
    });

    it('shows error when getUploadUrl fails', async () => {
      const user = userEvent.setup();
      const failingApi = createMockMediaApi({
        getUploadUrl: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'SERVER_ERROR', message: 'サーバーエラーが発生しました' },
        }),
      });
      render(<MediaUploadPage mediaApi={failingApi} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('サーバーエラーが発生しました')).toBeInTheDocument();
      });
    });

    it('shows error when S3 upload fails', async () => {
      const user = userEvent.setup();
      const failingApi = createMockMediaApi({
        uploadFileToS3: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'UPLOAD_FAILED', message: 'アップロードに失敗しました' },
        }),
      });
      render(<MediaUploadPage mediaApi={failingApi} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('アップロードに失敗しました')).toBeInTheDocument();
      });
    });
  });

  describe('reset and re-upload', () => {
    it('allows uploading another file after completion', async () => {
      const user = userEvent.setup();
      render(<MediaUploadPage mediaApi={mockApi} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        expect(screen.getByText('アップロードが完了しました')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: '別のファイルをアップロード' }));

      expect(screen.queryByText('アップロードが完了しました')).not.toBeInTheDocument();
      expect(screen.queryByText('recording.mp3')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA landmarks', () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      expect(screen.getByRole('main', { name: 'メディアアップロード' })).toBeInTheDocument();
    });

    it('drop zone is keyboard accessible', () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      const dropZone = screen.getByRole('button', { name: 'ファイルを選択 またはドラッグ＆ドロップ' });
      expect(dropZone).toHaveAttribute('tabIndex', '0');
    });

    // WCAG 2.1 AA SC 2.5.3 "Label in Name" (axe: label-content-name-mismatch).
    // The drop-zone button's visible descendant text must be fully contained
    // in its accessible name. The format-hint text lives OUTSIDE the button.
    it('drop zone button contains no visible text beyond its accessible name', () => {
      render(<MediaUploadPage mediaApi={mockApi} />);

      const dropZone = screen.getByRole('button', { name: 'ファイルを選択 またはドラッグ＆ドロップ' });
      const visibleText = dropZone.textContent?.replace(/\s+/g, ' ').trim() ?? '';

      // All visible text inside the button is included in the accessible name.
      expect('ファイルを選択 またはドラッグ＆ドロップ').toContain(visibleText);
      // The format hint must not be inside the button node.
      expect(dropZone.textContent).not.toMatch(/対応形式/);
    });

    it('has no accessibility violations (catches label-content-name-mismatch)', async () => {
      const { container } = render(<MediaUploadPage mediaApi={mockApi} />);
      await checkA11y(container);
    });

    it('progress bar has proper ARIA attributes', async () => {
      const user = userEvent.setup();
      // Mock uploadFileToS3 to call progress callback
      const progressApi = createMockMediaApi({
        uploadFileToS3: vi.fn().mockImplementation((_url, _file, onProgress) => {
          onProgress?.(50);
          return Promise.resolve({ ok: true, value: undefined });
        }),
      });
      render(<MediaUploadPage mediaApi={progressApi} />);

      const file = createFile('recording.mp3', 2048, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, file);
      await user.click(screen.getByRole('button', { name: 'アップロード開始' }));

      await waitFor(() => {
        const progressBar = screen.getByRole('progressbar', { name: 'アップロード進捗' });
        expect(progressBar).toBeInTheDocument();
      });
    });
  });
});
