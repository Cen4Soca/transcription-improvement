import { openDB, type IDBPDatabase } from 'idb';
import type { Correction } from '../types/correction';

const DB_NAME = 'transcription-review-offline';
const DB_VERSION = 1;
const STORE_NAME = 'sync-queue';
const MAX_QUEUE_SIZE = 200;

export interface QueueEntry {
  id: number;
  correctionId: string;
  correction: Correction;
  enqueuedAt: string;
}

export interface EnqueueResult {
  success: boolean;
  warning?: string;
}

export class OfflineSyncQueue {
  private db: IDBPDatabase | null = null;
  private online: boolean;
  private onlineListeners: Array<(online: boolean) => void> = [];

  constructor() {
    this.online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.online = true;
      this.notifyListeners();
    });

    window.addEventListener('offline', () => {
      this.online = false;
      this.notifyListeners();
    });
  }

  private notifyListeners(): void {
    for (const listener of this.onlineListeners) {
      listener(this.online);
    }
  }

  onConnectionChange(listener: (online: boolean) => void): () => void {
    this.onlineListeners.push(listener);
    return () => {
      this.onlineListeners = this.onlineListeners.filter((l) => l !== listener);
    };
  }

  isOnline(): boolean {
    return this.online;
  }

  private async getDb(): Promise<IDBPDatabase> {
    if (this.db) return this.db;

    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('correctionId', 'correctionId', { unique: true });
        }
      },
    });

    return this.db;
  }

  async enqueue(correction: Correction): Promise<EnqueueResult> {
    const db = await this.getDb();

    const existingIndex = db
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .index('correctionId');
    const existing = await existingIndex.get(correction.correctionId);
    if (existing) {
      return { success: true };
    }

    const entry: Omit<QueueEntry, 'id'> = {
      correctionId: correction.correctionId,
      correction,
      enqueuedAt: new Date().toISOString(),
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.add(entry);
    await tx.done;

    const count = await this.getCount();
    if (count > MAX_QUEUE_SIZE) {
      const discarded = await this.discardOldest(count - MAX_QUEUE_SIZE);
      return {
        success: true,
        warning: `キュー上限（${MAX_QUEUE_SIZE}件）を超過したため、最古の${discarded}件を破棄しました。`,
      };
    }

    return { success: true };
  }

  private async discardOldest(count: number): Promise<number> {
    const db = await this.getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let cursor = await store.openCursor();
    let deleted = 0;

    while (cursor && deleted < count) {
      await cursor.delete();
      deleted++;
      cursor = await cursor.continue();
    }

    await tx.done;
    return deleted;
  }

  async dequeue(): Promise<QueueEntry | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const cursor = await store.openCursor();
    if (!cursor) {
      await tx.done;
      return undefined;
    }

    const entry = cursor.value as QueueEntry;
    await cursor.delete();
    await tx.done;
    return entry;
  }

  async peek(): Promise<QueueEntry | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const cursor = await store.openCursor();
    await tx.done;

    if (!cursor) return undefined;
    return cursor.value as QueueEntry;
  }

  async getAll(): Promise<QueueEntry[]> {
    const db = await this.getDb();
    const entries = await db.getAll(STORE_NAME);
    return entries as QueueEntry[];
  }

  async clear(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).clear();
    await tx.done;
  }

  async getCount(): Promise<number> {
    const db = await this.getDb();
    return db.count(STORE_NAME);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
