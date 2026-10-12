import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoSave } from './useAutoSave';
import { DraftStorage } from '../services/draft-storage';

describe('useAutoSave', () => {
  let mockDraftStorage: DraftStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDraftStorage = {
      saveDraft: vi.fn(),
      getDraft: vi.fn(),
      deleteDraft: vi.fn(),
      getAllDrafts: vi.fn(),
      cleanExpiredDrafts: vi.fn(),
    } as unknown as DraftStorage;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves draft after 5 seconds when text changes', () => {
    renderHook(() =>
      useAutoSave(
        { sessionId: 's1', segmentId: 'seg1', text: 'hello', enabled: true },
        mockDraftStorage
      )
    );

    vi.advanceTimersByTime(5000);

    expect(mockDraftStorage.saveDraft).toHaveBeenCalledWith('s1', 'seg1', 'hello');
  });

  it('does not save when enabled is false', () => {
    renderHook(() =>
      useAutoSave(
        { sessionId: 's1', segmentId: 'seg1', text: 'hello', enabled: false },
        mockDraftStorage
      )
    );

    vi.advanceTimersByTime(10000);

    expect(mockDraftStorage.saveDraft).not.toHaveBeenCalled();
  });

  it('does not save again if text has not changed since last save', () => {
    renderHook(() =>
      useAutoSave(
        { sessionId: 's1', segmentId: 'seg1', text: 'hello', enabled: true },
        mockDraftStorage
      )
    );

    vi.advanceTimersByTime(5000);
    expect(mockDraftStorage.saveDraft).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    // Should not save again since text hasn't changed
    expect(mockDraftStorage.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('saves again when text changes between intervals', () => {
    const { rerender } = renderHook(
      (props) => useAutoSave(props, mockDraftStorage),
      {
        initialProps: { sessionId: 's1', segmentId: 'seg1', text: 'hello', enabled: true },
      }
    );

    vi.advanceTimersByTime(5000);
    expect(mockDraftStorage.saveDraft).toHaveBeenCalledWith('s1', 'seg1', 'hello');

    rerender({ sessionId: 's1', segmentId: 'seg1', text: 'hello world', enabled: true });

    vi.advanceTimersByTime(5000);
    expect(mockDraftStorage.saveDraft).toHaveBeenCalledWith('s1', 'seg1', 'hello world');
  });

  it('cleans up interval on unmount', () => {
    const { unmount } = renderHook(() =>
      useAutoSave(
        { sessionId: 's1', segmentId: 'seg1', text: 'hello', enabled: true },
        mockDraftStorage
      )
    );

    unmount();

    vi.advanceTimersByTime(10000);
    expect(mockDraftStorage.saveDraft).not.toHaveBeenCalled();
  });

  it('uses correct sessionId and segmentId', () => {
    renderHook(() =>
      useAutoSave(
        { sessionId: 'session-abc', segmentId: 'segment-xyz', text: 'content', enabled: true },
        mockDraftStorage
      )
    );

    vi.advanceTimersByTime(5000);

    expect(mockDraftStorage.saveDraft).toHaveBeenCalledWith(
      'session-abc',
      'segment-xyz',
      'content'
    );
  });
});
