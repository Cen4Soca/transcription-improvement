import { OfflineSyncQueue, type QueueEntry } from './offline-sync-queue';

export type SyncStatus = 'idle' | 'syncing' | 'completed' | 'failed';

export interface SyncManagerOptions {
  /** Function to send a correction to the API. Should throw on failure. */
  sendCorrection: (entry: QueueEntry) => Promise<void>;
  /** Initial backoff delay in ms (default: 1000) */
  initialDelay?: number;
  /** Maximum backoff delay in ms (default: 30000) */
  maxDelay?: number;
  /** Maximum retry attempts (default: 5) */
  maxRetries?: number;
}

/**
 * SyncManager - Manages offline sync with exponential backoff retry.
 *
 * Uses the existing OfflineSyncQueue to dequeue entries on connection restore
 * and send them to the API. Implements exponential backoff (initial 1s, max 30s,
 * max 5 retries). After 5 failures, stops and exposes a "manual retry" state.
 *
 * Requirements: 11.10, 11.11
 */
export class SyncManager {
  private queue: OfflineSyncQueue;
  private sendCorrection: (entry: QueueEntry) => Promise<void>;
  private initialDelay: number;
  private maxDelay: number;
  private maxRetries: number;

  private _status: SyncStatus = 'idle';
  private _retryCount = 0;
  private statusListeners: Array<(status: SyncStatus) => void> = [];
  private unsubscribeConnection: (() => void) | null = null;
  private syncInProgress = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(queue: OfflineSyncQueue, options: SyncManagerOptions) {
    this.queue = queue;
    this.sendCorrection = options.sendCorrection;
    this.initialDelay = options.initialDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 30000;
    this.maxRetries = options.maxRetries ?? 5;

    this.unsubscribeConnection = this.queue.onConnectionChange((online) => {
      if (online) {
        this.startSync();
      }
    });
  }

  get status(): SyncStatus {
    return this._status;
  }

  get retryCount(): number {
    return this._retryCount;
  }

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: SyncStatus): void {
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  /**
   * Calculate exponential backoff delay for the given attempt.
   * Formula: min(initialDelay * 2^attempt, maxDelay)
   */
  calculateDelay(attempt: number): number {
    const delay = this.initialDelay * Math.pow(2, attempt);
    return Math.min(delay, this.maxDelay);
  }

  /**
   * Start the sync process. Dequeues entries and sends them to the API.
   * On failure, retries with exponential backoff up to maxRetries.
   */
  async startSync(): Promise<void> {
    if (this.syncInProgress) return;
    if (this._status === 'failed') return;

    const count = await this.queue.getCount();
    if (count === 0) {
      return;
    }

    this.syncInProgress = true;
    this._retryCount = 0;
    this.setStatus('syncing');

    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    while (true) {
      const entry = await this.queue.peek();
      if (!entry) {
        this.syncInProgress = false;
        this.setStatus('completed');
        return;
      }

      try {
        await this.sendCorrection(entry);
        await this.queue.dequeue();
        this._retryCount = 0;
      } catch {
        this._retryCount++;

        if (this._retryCount >= this.maxRetries) {
          this.syncInProgress = false;
          this.setStatus('failed');
          return;
        }

        const delay = this.calculateDelay(this._retryCount - 1);
        await this.wait(delay);

        if (!this.queue.isOnline()) {
          this.syncInProgress = false;
          this.setStatus('idle');
          return;
        }
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timeoutId = setTimeout(resolve, ms);
    });
  }

  /**
   * Manual retry after 5 failures. Resets retry count and restarts sync.
   */
  async manualRetry(): Promise<void> {
    if (this._status !== 'failed') return;

    this._retryCount = 0;
    this.setStatus('idle');
    await this.startSync();
  }

  /**
   * Clean up listeners and timers.
   */
  destroy(): void {
    if (this.unsubscribeConnection) {
      this.unsubscribeConnection();
      this.unsubscribeConnection = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.statusListeners = [];
  }
}
