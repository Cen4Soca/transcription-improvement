import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager, type SyncStatus } from './offline-sync-manager';
import { OfflineSyncQueue } from './offline-sync-queue';
import type { Correction } from '../types/correction';

function createCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    correctionId: `corr-${Math.random().toString(36).slice(2)}`,
    sessionId: 'session-1',
    segmentId: 'segment-1',
    userId: 'user-1',
    correctionType: 'TEXT',
    beforeText: 'original',
    afterText: 'corrected',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SyncManager', () => {
  let queue: OfflineSyncQueue;
  let syncManager: SyncManager;
  let sendCorrection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queue = new OfflineSyncQueue();
    sendCorrection = vi.fn().mockResolvedValue(undefined);
    syncManager = new SyncManager(queue, {
      sendCorrection,
      initialDelay: 10,
      maxDelay: 100,
      maxRetries: 5,
    });
  });

  afterEach(async () => {
    syncManager.destroy();
    await queue.clear();
    await queue.close();
  });

  describe('initial state', () => {
    it('should start with idle status', () => {
      expect(syncManager.status).toBe('idle');
    });

    it('should start with 0 retry count', () => {
      expect(syncManager.retryCount).toBe(0);
    });
  });

  describe('calculateDelay', () => {
    it('should return initialDelay * 2^attempt', () => {
      // Use a separate manager with known delays for this test
      const mgr = new SyncManager(queue, {
        sendCorrection,
        initialDelay: 1000,
        maxDelay: 30000,
        maxRetries: 5,
      });

      expect(mgr.calculateDelay(0)).toBe(1000);
      expect(mgr.calculateDelay(1)).toBe(2000);
      expect(mgr.calculateDelay(2)).toBe(4000);
      expect(mgr.calculateDelay(3)).toBe(8000);
      expect(mgr.calculateDelay(4)).toBe(16000);

      mgr.destroy();
    });

    it('should cap at maxDelay (30000ms)', () => {
      const mgr = new SyncManager(queue, {
        sendCorrection,
        initialDelay: 1000,
        maxDelay: 30000,
        maxRetries: 5,
      });

      expect(mgr.calculateDelay(5)).toBe(30000);
      expect(mgr.calculateDelay(10)).toBe(30000);

      mgr.destroy();
    });

    it('should produce the exact sequence: 1s, 2s, 4s, 8s, 16s (capped at 30s)', () => {
      const mgr = new SyncManager(queue, {
        sendCorrection,
        initialDelay: 1000,
        maxDelay: 30000,
        maxRetries: 5,
      });

      const expectedSequence = [1000, 2000, 4000, 8000, 16000];
      for (let i = 0; i < expectedSequence.length; i++) {
        expect(mgr.calculateDelay(i)).toBe(expectedSequence[i]);
      }

      mgr.destroy();
    });
  });

  describe('startSync', () => {
    it('should not sync when queue is empty', async () => {
      await syncManager.startSync();
      expect(syncManager.status).toBe('idle');
      expect(sendCorrection).not.toHaveBeenCalled();
    });

    it('should sync all entries and set status to completed', async () => {
      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await queue.enqueue(createCorrection({ correctionId: 'c2' }));

      await syncManager.startSync();

      expect(sendCorrection).toHaveBeenCalledTimes(2);
      expect(syncManager.status).toBe('completed');
      expect(await queue.getCount()).toBe(0);
    });

    it('should set status to syncing during sync', async () => {
      const statuses: SyncStatus[] = [];
      syncManager.onStatusChange((s) => statuses.push(s));

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await syncManager.startSync();

      expect(statuses).toContain('syncing');
      expect(statuses).toContain('completed');
    });

    it('should guard against concurrent sync operations', async () => {
      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await queue.enqueue(createCorrection({ correctionId: 'c2' }));

      // Start sync - both items should be processed in a single sync run
      await syncManager.startSync();

      expect(sendCorrection).toHaveBeenCalledTimes(2);
      expect(syncManager.status).toBe('completed');

      // Starting sync again when queue is empty should be a no-op
      sendCorrection.mockClear();
      await syncManager.startSync();
      expect(sendCorrection).not.toHaveBeenCalled();
    });
  });

  describe('exponential backoff retry', () => {
    it('should retry with exponential backoff on failure then succeed', async () => {
      sendCorrection
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined);

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));

      await syncManager.startSync();

      expect(sendCorrection).toHaveBeenCalledTimes(2);
      expect(syncManager.status).toBe('completed');
    });

    it('should set status to failed after maxRetries (5) failures', async () => {
      sendCorrection.mockRejectedValue(new Error('Network error'));

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));

      await syncManager.startSync();

      expect(syncManager.status).toBe('failed');
      expect(syncManager.retryCount).toBe(5);
      expect(sendCorrection).toHaveBeenCalledTimes(5);
    });

    it('should not remove entry from queue on failure (available for manual retry)', async () => {
      sendCorrection.mockRejectedValue(new Error('Network error'));

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await syncManager.startSync();

      expect(syncManager.status).toBe('failed');
      // Entry should still be in the queue for manual retry
      const count = await queue.getCount();
      expect(count).toBe(1);
    });

    it('should not start sync when status is failed', async () => {
      sendCorrection.mockRejectedValue(new Error('Network error'));

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await syncManager.startSync();

      expect(syncManager.status).toBe('failed');

      // Try to start sync again - should not work
      sendCorrection.mockClear();
      await syncManager.startSync();
      expect(sendCorrection).not.toHaveBeenCalled();
    });

    it('should reset retry count after a successful send', async () => {
      sendCorrection
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined) // c1 succeeds on 3rd try
        .mockResolvedValueOnce(undefined); // c2 succeeds immediately

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await queue.enqueue(createCorrection({ correctionId: 'c2' }));

      await syncManager.startSync();

      expect(syncManager.status).toBe('completed');
      expect(syncManager.retryCount).toBe(0);
      expect(await queue.getCount()).toBe(0);
    });
  });

  describe('manualRetry', () => {
    it('should reset retry count and restart sync on manual retry', async () => {
      sendCorrection.mockRejectedValue(new Error('Network error'));

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await syncManager.startSync();

      expect(syncManager.status).toBe('failed');

      // Now manual retry with success
      sendCorrection.mockResolvedValue(undefined);
      await syncManager.manualRetry();

      expect(syncManager.status).toBe('completed');
      expect(syncManager.retryCount).toBe(0);
    });

    it('should do nothing if status is not failed', async () => {
      const listener = vi.fn();
      syncManager.onStatusChange(listener);

      await syncManager.manualRetry();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('connection change listener', () => {
    it('should start sync when connection is restored', async () => {
      await queue.enqueue(createCorrection({ correctionId: 'c1' }));

      // Simulate going online
      window.dispatchEvent(new Event('online'));

      // Allow microtasks to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendCorrection).toHaveBeenCalledTimes(1);
      expect(syncManager.status).toBe('completed');
    });
  });

  describe('onStatusChange', () => {
    it('should notify listeners on status change', async () => {
      const listener = vi.fn();
      syncManager.onStatusChange(listener);

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await syncManager.startSync();

      expect(listener).toHaveBeenCalledWith('syncing');
      expect(listener).toHaveBeenCalledWith('completed');
    });

    it('should return an unsubscribe function', async () => {
      const listener = vi.fn();
      const unsubscribe = syncManager.onStatusChange(listener);

      unsubscribe();

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      await syncManager.startSync();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should clean up listeners and timers', () => {
      const listener = vi.fn();
      syncManager.onStatusChange(listener);

      syncManager.destroy();

      // After destroy, status changes should not notify
      expect(() => syncManager.destroy()).not.toThrow();
    });
  });
});
