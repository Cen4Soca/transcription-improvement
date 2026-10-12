import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { OfflineSyncQueue } from './offline-sync-queue';
import { SyncManager } from './offline-sync-manager';
import type { Correction } from '../types/correction';
import type { QueueEntry } from './offline-sync-queue';

/**
 * Arbitrary that generates valid Correction values with unique correctionIds.
 */
const correctionArb = (index: number): fc.Arbitrary<Correction> =>
  fc.record({
    correctionId: fc.constant(`corr-${index}-${Date.now()}`),
    sessionId: fc.constant('session-1'),
    segmentId: fc.constantFrom('seg-1', 'seg-2', 'seg-3', 'seg-4', 'seg-5'),
    userId: fc.constant('user-1'),
    correctionType: fc.constant('TEXT' as const),
    beforeText: fc.string({ minLength: 1, maxLength: 50 }),
    afterText: fc.string({ minLength: 1, maxLength: 50 }),
    createdAt: fc.constant(new Date().toISOString()),
  });

/**
 * Generates a list of corrections with unique correctionIds.
 */
const uniqueCorrectionsArb = (minLength: number, maxLength: number): fc.Arbitrary<Correction[]> =>
  fc.integer({ min: minLength, max: maxLength }).chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_, i) => correctionArb(i))
    ) as fc.Arbitrary<Correction[]>
  );

describe('Feature: offline-sync-queue, Property 42: オフラインキューの同期完全性', () => {
  let queue: OfflineSyncQueue;

  beforeEach(() => {
    queue = new OfflineSyncQueue();
  });

  afterEach(async () => {
    await queue.clear();
    await queue.close();
  });

  /**
   * **Validates: Requirements 11.10**
   *
   * All corrections enqueued while offline are eventually synced when connection
   * is restored. The sync maintains FIFO order, each correction's correctionId
   * is used as an idempotency key (no duplicates sent), and after successful
   * sync the queue is empty.
   */
  it('all enqueued corrections are synced in FIFO order with no duplicates and queue is empty after sync', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueCorrectionsArb(1, 10),
        async (corrections: Correction[]) => {
          // Fresh queue for each run
          const testQueue = new OfflineSyncQueue();

          try {
            // Enqueue all corrections (simulating offline state)
            for (const correction of corrections) {
              await testQueue.enqueue(correction);
            }

            // Verify all corrections are in the queue
            const queuedCount = await testQueue.getCount();
            expect(queuedCount).toBe(corrections.length);

            // Track sent corrections in order
            const sentEntries: QueueEntry[] = [];
            const sentCorrectionIds = new Set<string>();

            const sendCorrection = async (entry: QueueEntry): Promise<void> => {
              sentEntries.push(entry);
              sentCorrectionIds.add(entry.correctionId);
            };

            // Create SyncManager and start sync
            const syncManager = new SyncManager(testQueue, {
              sendCorrection,
              initialDelay: 1,
              maxDelay: 10,
              maxRetries: 3,
            });

            await syncManager.startSync();

            // Property 1: All corrections are eventually synced
            expect(sentEntries.length).toBe(corrections.length);

            // Property 2: FIFO order is maintained
            for (let i = 0; i < corrections.length; i++) {
              expect(sentEntries[i].correctionId).toBe(corrections[i].correctionId);
            }

            // Property 3: No duplicate correctionIds sent (idempotency key uniqueness)
            expect(sentCorrectionIds.size).toBe(corrections.length);

            // Property 4: Queue is empty after successful sync
            const remainingCount = await testQueue.getCount();
            expect(remainingCount).toBe(0);

            // Status should be completed
            expect(syncManager.status).toBe('completed');

            syncManager.destroy();
          } finally {
            await testQueue.clear();
            await testQueue.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
