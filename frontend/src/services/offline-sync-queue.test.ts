import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OfflineSyncQueue, type QueueEntry } from './offline-sync-queue';
import type { Correction } from '../types/correction';

function createCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    correctionId: `corr-${Math.random().toString(36).slice(2)}`,
    sessionId: 'session-1',
    segmentId: 'segment-1',
    userId: 'user-1',
    correctionType: 'TEXT',
    beforeText: 'original text',
    afterText: 'corrected text',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('OfflineSyncQueue', () => {
  let queue: OfflineSyncQueue;

  beforeEach(() => {
    queue = new OfflineSyncQueue();
  });

  afterEach(async () => {
    await queue.clear();
    await queue.close();
  });

  describe('enqueue', () => {
    it('should add a correction to the queue', async () => {
      const correction = createCorrection();
      const result = await queue.enqueue(correction);

      expect(result.success).toBe(true);
      expect(result.warning).toBeUndefined();

      const count = await queue.getCount();
      expect(count).toBe(1);
    });

    it('should include correctionId as idempotency key', async () => {
      const correction = createCorrection({ correctionId: 'idempotent-key-1' });
      await queue.enqueue(correction);

      const entries = await queue.getAll();
      expect(entries[0].correctionId).toBe('idempotent-key-1');
    });

    it('should not duplicate entries with the same correctionId', async () => {
      const correction = createCorrection({ correctionId: 'dup-key' });
      await queue.enqueue(correction);
      await queue.enqueue(correction);

      const count = await queue.getCount();
      expect(count).toBe(1);
    });

    it('should enforce 200 item limit and discard oldest entries', async () => {
      for (let i = 0; i < 201; i++) {
        await queue.enqueue(
          createCorrection({ correctionId: `corr-${i}` })
        );
      }

      const count = await queue.getCount();
      expect(count).toBe(200);

      const entries = await queue.getAll();
      expect(entries[0].correctionId).toBe('corr-1');
      expect(entries[entries.length - 1].correctionId).toBe('corr-200');
    });

    it('should return a warning when queue limit is exceeded', async () => {
      for (let i = 0; i < 200; i++) {
        await queue.enqueue(
          createCorrection({ correctionId: `corr-${i}` })
        );
      }

      const result = await queue.enqueue(
        createCorrection({ correctionId: 'corr-overflow' })
      );

      expect(result.success).toBe(true);
      expect(result.warning).toContain('200');
      expect(result.warning).toContain('破棄');
    });
  });

  describe('dequeue', () => {
    it('should remove and return the oldest entry (FIFO)', async () => {
      const c1 = createCorrection({ correctionId: 'first' });
      const c2 = createCorrection({ correctionId: 'second' });
      await queue.enqueue(c1);
      await queue.enqueue(c2);

      const entry = await queue.dequeue();
      expect(entry?.correctionId).toBe('first');

      const count = await queue.getCount();
      expect(count).toBe(1);
    });

    it('should return undefined when queue is empty', async () => {
      const entry = await queue.dequeue();
      expect(entry).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('should return the oldest entry without removing it', async () => {
      const c1 = createCorrection({ correctionId: 'peek-first' });
      await queue.enqueue(c1);

      const entry = await queue.peek();
      expect(entry?.correctionId).toBe('peek-first');

      const count = await queue.getCount();
      expect(count).toBe(1);
    });

    it('should return undefined when queue is empty', async () => {
      const entry = await queue.peek();
      expect(entry).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all entries in FIFO order', async () => {
      const corrections = Array.from({ length: 5 }, (_, i) =>
        createCorrection({ correctionId: `all-${i}` })
      );

      for (const c of corrections) {
        await queue.enqueue(c);
      }

      const entries = await queue.getAll();
      expect(entries).toHaveLength(5);
      entries.forEach((entry: QueueEntry, i: number) => {
        expect(entry.correctionId).toBe(`all-${i}`);
      });
    });

    it('should return empty array when queue is empty', async () => {
      const entries = await queue.getAll();
      expect(entries).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should remove all entries from the queue', async () => {
      for (let i = 0; i < 5; i++) {
        await queue.enqueue(createCorrection());
      }

      await queue.clear();
      const count = await queue.getCount();
      expect(count).toBe(0);
    });
  });

  describe('getCount', () => {
    it('should return the number of entries in the queue', async () => {
      expect(await queue.getCount()).toBe(0);

      await queue.enqueue(createCorrection({ correctionId: 'c1' }));
      expect(await queue.getCount()).toBe(1);

      await queue.enqueue(createCorrection({ correctionId: 'c2' }));
      expect(await queue.getCount()).toBe(2);
    });
  });

  describe('isOnline', () => {
    it('should return current online status', () => {
      const online = queue.isOnline();
      expect(typeof online).toBe('boolean');
    });
  });

  describe('onConnectionChange', () => {
    it('should notify listeners when going offline', () => {
      const listener = vi.fn();
      queue.onConnectionChange(listener);

      window.dispatchEvent(new Event('offline'));

      expect(listener).toHaveBeenCalledWith(false);
      expect(queue.isOnline()).toBe(false);
    });

    it('should notify listeners when going online', () => {
      const listener = vi.fn();
      queue.onConnectionChange(listener);

      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));

      expect(listener).toHaveBeenCalledWith(true);
      expect(queue.isOnline()).toBe(true);
    });

    it('should return an unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = queue.onConnectionChange(listener);

      unsubscribe();
      window.dispatchEvent(new Event('offline'));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('FIFO ordering', () => {
    it('should maintain insertion order across multiple dequeue operations', async () => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      for (const id of ids) {
        await queue.enqueue(createCorrection({ correctionId: id }));
      }

      const dequeued: string[] = [];
      let entry = await queue.dequeue();
      while (entry) {
        dequeued.push(entry.correctionId);
        entry = await queue.dequeue();
      }

      expect(dequeued).toEqual(ids);
    });
  });

  describe('entry structure', () => {
    it('should include correctionId and enqueuedAt timestamp', async () => {
      const correction = createCorrection({ correctionId: 'struct-test' });
      await queue.enqueue(correction);

      const entries = await queue.getAll();
      const entry = entries[0];

      expect(entry.correctionId).toBe('struct-test');
      expect(entry.correction).toEqual(correction);
      expect(entry.enqueuedAt).toBeDefined();
      expect(new Date(entry.enqueuedAt).toISOString()).toBe(entry.enqueuedAt);
    });

    it('should store the full correction object for later sync', async () => {
      const correction = createCorrection({
        correctionId: 'full-obj-test',
        sessionId: 'session-abc',
        segmentId: 'segment-xyz',
        beforeText: 'before',
        afterText: 'after',
      });
      await queue.enqueue(correction);

      const entries = await queue.getAll();
      const entry = entries[0];

      expect(entry.correction.sessionId).toBe('session-abc');
      expect(entry.correction.segmentId).toBe('segment-xyz');
      expect(entry.correction.beforeText).toBe('before');
      expect(entry.correction.afterText).toBe('after');
    });
  });

  describe('queue overflow behavior', () => {
    it('should maintain FIFO order after overflow discard', async () => {
      // Enqueue 205 items, expect oldest 5 to be discarded
      for (let i = 0; i < 205; i++) {
        await queue.enqueue(
          createCorrection({ correctionId: `overflow-${i}` })
        );
      }

      const count = await queue.getCount();
      expect(count).toBe(200);

      // First entry should be the 6th one (index 5) since 0-4 were discarded
      const entries = await queue.getAll();
      expect(entries[0].correctionId).toBe('overflow-5');
      expect(entries[entries.length - 1].correctionId).toBe('overflow-204');
    });
  });
});
