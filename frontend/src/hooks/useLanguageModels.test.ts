import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLanguageModels } from './useLanguageModels';
import type { LanguageModelApi } from '../services/language-model-api';

function createMockLanguageModelApi(): LanguageModelApi {
  return {
    listModels: vi.fn(),
    createModel: vi.fn(),
    getModelStatus: vi.fn(),
  } as unknown as LanguageModelApi;
}

describe('useLanguageModels', () => {
  let mockApi: LanguageModelApi;

  beforeEach(() => {
    vi.useFakeTimers();
    mockApi = createMockLanguageModelApi();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('initial state has empty models and no errors', () => {
    const { result } = renderHook(() => useLanguageModels(mockApi));

    expect(result.current.models).toEqual([]);
    expect(result.current.isLoadingModels).toBe(false);
    expect(result.current.modelsError).toBeNull();
    expect(result.current.isCreating).toBe(false);
    expect(result.current.createError).toBeNull();
    expect(result.current.modelStatus).toBeNull();
    expect(result.current.isPollingStatus).toBe(false);
  });

  test('loadModels fetches and stores model list', async () => {
    const mockModels = [
      { modelName: 'model-1', modelStatus: 'COMPLETED', baseModelName: 'NarrowBand' },
      { modelName: 'model-2', modelStatus: 'COMPLETED', baseModelName: 'WideBand' },
    ];
    (mockApi.listModels as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { models: mockModels },
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      await result.current.loadModels();
    });

    expect(result.current.models).toEqual(mockModels);
    expect(result.current.isLoadingModels).toBe(false);
    expect(result.current.modelsError).toBeNull();
  });

  test('loadModels sets error on failure', async () => {
    (mockApi.listModels as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Access denied' },
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      await result.current.loadModels();
    });

    expect(result.current.models).toEqual([]);
    expect(result.current.modelsError?.code).toBe('FORBIDDEN');
  });

  test('createModel returns record on success', async () => {
    const mockRecord = {
      modelName: 'new-model',
      baseModelName: 'NarrowBand',
      status: 'IN_PROGRESS',
      trainingDataS3Uri: 's3://bucket/training-data/new-model/training.txt',
      createdBy: 'user-1',
      createdAt: '2024-01-01T00:00:00Z',
    };
    (mockApi.createModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockRecord,
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    let record: unknown;
    await act(async () => {
      record = await result.current.createModel({
        modelName: 'new-model',
        baseModelName: 'NarrowBand',
        sessionIds: ['session-1'],
      });
    });

    expect(record).toEqual(mockRecord);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.createError).toBeNull();
  });

  test('createModel sets error and returns null on failure', async () => {
    (mockApi.createModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'DUPLICATE_MODEL_NAME', message: 'Model name already exists' },
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    let record: unknown;
    await act(async () => {
      record = await result.current.createModel({
        modelName: 'existing-model',
        baseModelName: 'WideBand',
        sessionIds: ['session-1'],
      });
    });

    expect(record).toBeNull();
    expect(result.current.createError?.code).toBe('DUPLICATE_MODEL_NAME');
  });

  test('startStatusPolling fetches status immediately', async () => {
    const mockStatus = { modelName: 'model-1', modelStatus: 'IN_PROGRESS' };
    (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockStatus,
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      result.current.startStatusPolling('model-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.modelStatus).toEqual(mockStatus);
    expect(result.current.isPollingStatus).toBe(true);
    expect(mockApi.getModelStatus).toHaveBeenCalledWith('model-1');

    // Cleanup
    act(() => { result.current.stopStatusPolling(); });
  });

  test('status polling stops when model reaches COMPLETED', async () => {
    const completedStatus = { modelName: 'model-1', modelStatus: 'COMPLETED' };
    (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: completedStatus,
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      result.current.startStatusPolling('model-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPollingStatus).toBe(false);
    expect(result.current.modelStatus?.modelStatus).toBe('COMPLETED');
  });

  test('status polling stops when model reaches FAILED', async () => {
    const failedStatus = {
      modelName: 'model-1',
      modelStatus: 'FAILED',
      failureReason: 'Training data insufficient',
    };
    (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: failedStatus,
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      result.current.startStatusPolling('model-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPollingStatus).toBe(false);
    expect(result.current.modelStatus?.failureReason).toBe('Training data insufficient');
  });

  test('stopStatusPolling stops the polling interval', async () => {
    const mockStatus = { modelName: 'model-1', modelStatus: 'IN_PROGRESS' };
    (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockStatus,
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      result.current.startStatusPolling('model-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPollingStatus).toBe(true);

    act(() => {
      result.current.stopStatusPolling();
    });

    expect(result.current.isPollingStatus).toBe(false);
  });

  test('status polling sets error on API failure', async () => {
    (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Model not found' },
    });

    const { result } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      result.current.startStatusPolling('nonexistent-model');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.statusError?.code).toBe('NOT_FOUND');

    // Cleanup
    act(() => { result.current.stopStatusPolling(); });
  });

  test('cleanup on unmount clears status polling interval', async () => {
    const mockStatus = { modelName: 'model-1', modelStatus: 'IN_PROGRESS' };
    (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: mockStatus,
    });

    const { result, unmount } = renderHook(() => useLanguageModels(mockApi));

    await act(async () => {
      result.current.startStatusPolling('model-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();

    // Advancing timers after unmount should not cause additional API calls
    const callCountBefore = (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    const callCountAfter = (mockApi.getModelStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);
  });
});
