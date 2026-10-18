import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MediaFileList } from './MediaFileList';
import type { MediaApi, MediaFile, MediaFileListResponse } from '../services/media-api';
import type { Result, AppError } from '../types/api';

function createMockMediaApi(
  response: Result<MediaFileListResponse, AppError>,
): MediaApi {
  return {
    listMediaFiles: vi.fn().mockResolvedValue(response),
    getUploadUrl: vi.fn(),
    uploadFileToS3: vi.fn(),
  } as unknown as MediaApi;
}

const mockMediaFiles: MediaFile[] = [
  {
    mediaFileId: 'media-1',
    filename: '会議録音.mp3',
    s3Key: 'media/media-1/会議録音.mp3',
    contentType: 'audio/mpeg',
    fileSize: 5242880, // 5MB
    uploadedBy: 'user-1',
    status: 'COMPLETED',
    createdAt: '2024-06-01T10:00:00.000Z',
    updatedAt: '2024-06-01T10:05:00.000Z',
  },
  {
    mediaFileId: 'media-2',
    filename: 'インタビュー.wav',
    s3Key: 'media/media-2/インタビュー.wav',
    contentType: 'audio/wav',
    fileSize: 104857600, // 100MB
    uploadedBy: 'user-2',
    status: 'PROCESSING',
    createdAt: '2024-06-02T14:30:00.000Z',
    updatedAt: '2024-06-02T14:30:00.000Z',
  },
  {
    mediaFileId: 'media-3',
    filename: 'プレゼン動画.mp4',
    s3Key: 'media/media-3/プレゼン動画.mp4',
    contentType: 'video/mp4',
    fileSize: 1073741824, // 1GB
    uploadedBy: 'user-1',
    status: 'UPLOADING',
    createdAt: '2024-06-03T09:00:00.000Z',
    updatedAt: '2024-06-03T09:00:00.000Z',
  },
  {
    mediaFileId: 'media-4',
    filename: '失敗音声.mp3',
    s3Key: 'media/media-4/失敗音声.mp3',
    contentType: 'audio/mpeg',
    fileSize: 2097152, // 2MB
    uploadedBy: 'user-2',
    status: 'FAILED',
    createdAt: '2024-06-04T08:00:00.000Z',
    updatedAt: '2024-06-04T08:10:00.000Z',
  },
];

describe('MediaFileList', () => {
  let mockApi: MediaApi;

  beforeEach(() => {
    mockApi = createMockMediaApi({
      ok: true,
      value: { data: { mediaFiles: mockMediaFiles } },
    });
  });

  it('renders loading state initially', () => {
    // Use a never-resolving promise to keep loading state
    const api = {
      listMediaFiles: vi.fn().mockReturnValue(new Promise(() => {})),
      getUploadUrl: vi.fn(),
      uploadFileToS3: vi.fn(),
    } as unknown as MediaApi;

    render(<MediaFileList mediaApi={api} />);
    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
  });

  it('renders media file list after loading', async () => {
    render(<MediaFileList mediaApi={mockApi} />);

    await waitFor(() => {
      expect(screen.getByText('会議録音.mp3')).toBeInTheDocument();
    });

    expect(screen.getByText('インタビュー.wav')).toBeInTheDocument();
    expect(screen.getByText('プレゼン動画.mp4')).toBeInTheDocument();
  });

  it('displays correct status badges', async () => {
    render(<MediaFileList mediaApi={mockApi} />);

    await waitFor(() => {
      expect(screen.getByText('完了')).toBeInTheDocument();
    });

    expect(screen.getByText('処理中')).toBeInTheDocument();
    expect(screen.getByText('アップロード中')).toBeInTheDocument();
    expect(screen.getByText('失敗')).toBeInTheDocument();
  });

  it('displays file sizes in human-readable format', async () => {
    render(<MediaFileList mediaApi={mockApi} />);

    await waitFor(() => {
      expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
    });

    expect(screen.getByText(/100\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/1\.00 GB/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
  });

  it('shows empty message when no media files', async () => {
    const emptyApi = createMockMediaApi({
      ok: true,
      value: { data: { mediaFiles: [] } },
    });

    render(<MediaFileList mediaApi={emptyApi} />);

    await waitFor(() => {
      expect(screen.getByText('メディアファイルがありません')).toBeInTheDocument();
    });
  });

  it('shows error message on API failure', async () => {
    const errorApi = createMockMediaApi({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'ネットワークに接続できません。',
      },
    });

    render(<MediaFileList mediaApi={errorApi} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('ネットワークに接続できません。')).toBeInTheDocument();
  });

  it('refetches when refreshKey changes', async () => {
    const { rerender } = render(<MediaFileList mediaApi={mockApi} refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByText('会議録音.mp3')).toBeInTheDocument();
    });

    expect(mockApi.listMediaFiles).toHaveBeenCalledTimes(1);

    rerender(<MediaFileList mediaApi={mockApi} refreshKey={1} />);

    await waitFor(() => {
      expect(mockApi.listMediaFiles).toHaveBeenCalledTimes(2);
    });
  });
});
