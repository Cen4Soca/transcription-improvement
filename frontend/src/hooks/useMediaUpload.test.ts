import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaUpload } from './useMediaUpload';
import type { MediaApi } from '../services/media-api';

function createMockMediaApi(): MediaApi {
  return {
    getUploadUrl: vi.fn(),
    listMediaFiles: vi.fn(),
    uploadFileToS3: vi.fn(),
  } as unknown as MediaApi;
}

function createFile(name: string, size: number, type = 'audio/mpeg'): File {
  const content = new ArrayBuffer(Math.min(size, 100));
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('useMediaUpload', () => {
  let mockApi: MediaApi;

  beforeEach(() => {
    mockApi = createMockMediaApi();
  });

  test('initial state is idle', () => {
    const { result } = renderHook(() => useMediaUpload(mockApi));

    expect(result.current.uploadState.phase).toBe('idle');
    expect(result.current.uploadState.progress).toBe(0);
    expect(result.current.uploadState.mediaFileId).toBeNull();
    expect(result.current.uploadState.error).toBeNull();
    expect(result.current.mediaFiles).toEqual([]);
  });

  test('rejects unsupported file format', async () => {
    const { result } = renderHook(() => useMediaUpload(mockApi));
    const file = createFile('document.pdf', 1024);

    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.uploadState.phase).toBe('error');
    expect(result.current.uploadState.error?.code).toBe('UNSUPPORTED_FILE_FORMAT');
    expect(result.current.uploadState.error?.details).toContain('mp3');
  });

  test('rejects file exceeding 2GB', async () => {
    const { result } = renderHook(() => useMediaUpload(mockApi));
    const file = createFile('large.mp3', 2 * 1024 * 1024 * 1024 + 1, 'audio/mpeg');

    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.uploadState.phase).toBe('error');
    expect(result.current.uploadState.error?.code).toBe('FILE_TOO_LARGE');
    expect(result.current.uploadState.error?.details).toContain('2GB');
  });

  test('completes upload successfully', async () => {
    const getUploadUrl = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        presignedUrl: 'https://s3.example.com/upload',
        mediaFileId: 'media-123',
        s3Key: 'media/media-123/test.mp3',
        expiresAt: '2024-01-01T01:00:00Z',
      },
    });
    const uploadFileToS3 = vi.fn().mockResolvedValue({ ok: true, value: undefined });

    mockApi = {
      getUploadUrl,
      listMediaFiles: vi.fn(),
      uploadFileToS3,
    } as unknown as MediaApi;

    const { result } = renderHook(() => useMediaUpload(mockApi));
    const file = createFile('test.mp3', 1024, 'audio/mpeg');

    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.uploadState.phase).toBe('completed');
    expect(result.current.uploadState.progress).toBe(100);
    expect(result.current.uploadState.mediaFileId).toBe('media-123');
    expect(getUploadUrl).toHaveBeenCalledWith({
      filename: 'test.mp3',
      contentType: 'audio/mpeg',
      fileSize: 1024,
    });
  });

  test('handles presigned URL request failure', async () => {
    const getUploadUrl = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'SERVER_ERROR', message: 'Internal error' },
    });

    mockApi = {
      getUploadUrl,
      listMediaFiles: vi.fn(),
      uploadFileToS3: vi.fn(),
    } as unknown as MediaApi;

    const { result } = renderHook(() => useMediaUpload(mockApi));
    const file = createFile('test.wav', 1024, 'audio/wav');

    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.uploadState.phase).toBe('error');
    expect(result.current.uploadState.error?.code).toBe('SERVER_ERROR');
  });

  test('handles S3 upload failure', async () => {
    const getUploadUrl = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        presignedUrl: 'https://s3.example.com/upload',
        mediaFileId: 'media-456',
        s3Key: 'media/media-456/test.flac',
        expiresAt: '2024-01-01T01:00:00Z',
      },
    });
    const uploadFileToS3 = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'UPLOAD_FAILED', message: 'Upload failed' },
    });

    mockApi = {
      getUploadUrl,
      listMediaFiles: vi.fn(),
      uploadFileToS3,
    } as unknown as MediaApi;

    const { result } = renderHook(() => useMediaUpload(mockApi));
    const file = createFile('test.flac', 2048, 'audio/flac');

    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.uploadState.phase).toBe('error');
    expect(result.current.uploadState.error?.code).toBe('UPLOAD_FAILED');
    expect(result.current.uploadState.mediaFileId).toBe('media-456');
  });

  test('reset returns to idle state', async () => {
    const getUploadUrl = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        presignedUrl: 'https://s3.example.com/upload',
        mediaFileId: 'media-789',
        s3Key: 'media/media-789/test.mp4',
        expiresAt: '2024-01-01T01:00:00Z',
      },
    });
    const uploadFileToS3 = vi.fn().mockResolvedValue({ ok: true, value: undefined });

    mockApi = {
      getUploadUrl,
      listMediaFiles: vi.fn(),
      uploadFileToS3,
    } as unknown as MediaApi;

    const { result } = renderHook(() => useMediaUpload(mockApi));
    const file = createFile('test.mp4', 1024, 'video/mp4');

    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.uploadState.phase).toBe('completed');

    act(() => {
      result.current.reset();
    });

    expect(result.current.uploadState.phase).toBe('idle');
    expect(result.current.uploadState.progress).toBe(0);
    expect(result.current.uploadState.mediaFileId).toBeNull();
  });

  test('loadMediaFiles fetches and stores media files', async () => {
    const mockFiles = [
      { mediaFileId: 'f1', filename: 'a.mp3', status: 'COMPLETED' },
      { mediaFileId: 'f2', filename: 'b.wav', status: 'UPLOADING' },
    ];
    const listMediaFiles = vi.fn().mockResolvedValue({
      ok: true,
      value: { data: { mediaFiles: mockFiles } },
    });

    mockApi = {
      getUploadUrl: vi.fn(),
      listMediaFiles,
      uploadFileToS3: vi.fn(),
    } as unknown as MediaApi;

    const { result } = renderHook(() => useMediaUpload(mockApi));

    await act(async () => {
      await result.current.loadMediaFiles();
    });

    expect(result.current.mediaFiles).toEqual(mockFiles);
    expect(result.current.isLoadingFiles).toBe(false);
  });

  test('accepts all supported file extensions', async () => {
    const extensions = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'amr', 'webm', 'mp4', 'mkv', 'avi', 'mov'];

    for (const ext of extensions) {
      const getUploadUrl = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          presignedUrl: 'https://s3.example.com/upload',
          mediaFileId: `media-${ext}`,
          s3Key: `media/media-${ext}/test.${ext}`,
          expiresAt: '2024-01-01T01:00:00Z',
        },
      });
      const uploadFileToS3 = vi.fn().mockResolvedValue({ ok: true, value: undefined });

      const api = {
        getUploadUrl,
        listMediaFiles: vi.fn(),
        uploadFileToS3,
      } as unknown as MediaApi;

      const { result } = renderHook(() => useMediaUpload(api));
      const file = createFile(`test.${ext}`, 1024);

      await act(async () => {
        await result.current.upload(file);
      });

      expect(result.current.uploadState.phase).toBe('completed');
    }
  });
});
