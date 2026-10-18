import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranscriptionJob } from './useTranscriptionJob';
import type { TranscriptionApi, TranscriptionJob } from '../services/transcription-api';

function createMockTranscriptionApi(): TranscriptionApi {
  return {
    startJob: vi.fn(),
    getJobStatus: vi.fn(),
    downloadJson: vi.fn(),
    downloadSrt: vi.fn(),
  } as unknown as TranscriptionApi;
}

function createMockJob(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    jobId: 'job-123',
    transcribeJobName: 'transcribe-job-123',
    mediaFileId: 'media-456',
    status: 'IN_PROGRESS',
    languageCode: 'ja-JP',
    maxSpeakerLabels: 2,
    startedBy: 'user-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useTranscriptionJob', () => {
  let mockApi: TranscriptionApi;

  beforeEach(() => {
    vi.useFakeTimers();
    mockApi = createMockTranscriptionApi();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('initial state has no job and is not polling', () => {
    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    expect(result.current.job).toBeNull();
    expect(result.current.isPolling).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('fetchStatus retrieves job status', async () => {
    const mockJob = createMockJob();
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockJob,
    });

    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      await result.current.fetchStatus('job-123');
    });

    expect(result.current.job).toEqual(mockJob);
    expect(result.current.error).toBeNull();
  });

  test('fetchStatus sets error on failure', async () => {
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Job not found' },
    });

    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      await result.current.fetchStatus('job-999');
    });

    expect(result.current.error?.code).toBe('NOT_FOUND');
  });

  test('startPolling fetches immediately and sets isPolling', async () => {
    const mockJob = createMockJob();
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockJob,
    });

    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      result.current.startPolling('job-123');
    });

    // Allow the initial fetch promise to resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPolling).toBe(true);
    expect(result.current.job).toEqual(mockJob);
    expect(mockApi.getJobStatus).toHaveBeenCalledWith('job-123');

    // Cleanup
    act(() => { result.current.stopPolling(); });
  });

  test('polling stops when job reaches COMPLETED status', async () => {
    const completedJob = createMockJob({ status: 'COMPLETED' });
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: completedJob,
    });

    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      result.current.startPolling('job-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPolling).toBe(false);
    expect(result.current.job?.status).toBe('COMPLETED');
  });

  test('polling stops when job reaches FAILED status', async () => {
    const failedJob = createMockJob({ status: 'FAILED', failureReason: 'Transcribe error' });
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: failedJob,
    });

    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      result.current.startPolling('job-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPolling).toBe(false);
    expect(result.current.job?.status).toBe('FAILED');
    expect(result.current.job?.failureReason).toBe('Transcribe error');
  });

  test('stopPolling stops the polling interval', async () => {
    const mockJob = createMockJob();
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockJob,
    });

    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      result.current.startPolling('job-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPolling).toBe(true);

    act(() => {
      result.current.stopPolling();
    });

    expect(result.current.isPolling).toBe(false);
  });

  test('polling calls getJobStatus at intervals', async () => {
    let callCount = 0;
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount >= 3) {
        return { ok: true, value: createMockJob({ status: 'COMPLETED' }) };
      }
      return { ok: true, value: createMockJob() };
    });

    const { result } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      result.current.startPolling('job-123');
      // Initial fetch
      await vi.runAllTimersAsync();
    });

    // Advance timer for second poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Advance timer for third poll (should complete)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(callCount).toBe(3);
    expect(result.current.isPolling).toBe(false);
    expect(result.current.job?.status).toBe('COMPLETED');
  });

  test('cleanup on unmount clears interval', async () => {
    const mockJob = createMockJob();
    (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockJob,
    });

    const { result, unmount } = renderHook(() => useTranscriptionJob(mockApi));

    await act(async () => {
      result.current.startPolling('job-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();

    // Advancing timers after unmount should not cause additional API calls
    const callCountBefore = (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    const callCountAfter = (mockApi.getJobStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);
  });
});
