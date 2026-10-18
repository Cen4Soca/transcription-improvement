const DRAFT_PREFIX = 'draft_';
const EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface DraftEntry {
  text: string;
  savedAt: string; // ISO 8601 timestamp
}

export interface DraftInfo {
  sessionId: string;
  segmentId: string;
  text: string;
  savedAt: string;
}

/**
 * DraftStorage - localStorage を使用した編集中テキストの自動保存管理
 *
 * - キー形式: `draft_{sessionId}_{segmentId}`
 * - 各エントリに保存時刻（ISO 8601）を記録
 * - 24時間経過したエントリは自動削除対象
 *
 * Requirements: 11.9
 */
export class DraftStorage {
  private storage: Storage;

  constructor(storage: Storage = localStorage) {
    this.storage = storage;
  }

  private buildKey(sessionId: string, segmentId: string): string {
    return `${DRAFT_PREFIX}${sessionId}_${segmentId}`;
  }

  private parseKey(key: string): { sessionId: string; segmentId: string } | null {
    if (!key.startsWith(DRAFT_PREFIX)) return null;
    const rest = key.slice(DRAFT_PREFIX.length);
    const firstUnderscoreIndex = rest.indexOf('_');
    if (firstUnderscoreIndex === -1) return null;
    const sessionId = rest.slice(0, firstUnderscoreIndex);
    const segmentId = rest.slice(firstUnderscoreIndex + 1);
    if (!sessionId || !segmentId) return null;
    return { sessionId, segmentId };
  }

  saveDraft(sessionId: string, segmentId: string, text: string): void {
    const key = this.buildKey(sessionId, segmentId);
    const entry: DraftEntry = {
      text,
      savedAt: new Date().toISOString(),
    };
    this.storage.setItem(key, JSON.stringify(entry));
  }

  getDraft(sessionId: string, segmentId: string): DraftEntry | null {
    const key = this.buildKey(sessionId, segmentId);
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as DraftEntry;
      if (!entry.text && entry.text !== '' || !entry.savedAt) return null;
      return entry;
    } catch {
      return null;
    }
  }

  deleteDraft(sessionId: string, segmentId: string): void {
    const key = this.buildKey(sessionId, segmentId);
    this.storage.removeItem(key);
  }

  getAllDrafts(sessionId: string): DraftInfo[] {
    const drafts: DraftInfo[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key) continue;
      const parsed = this.parseKey(key);
      if (!parsed || parsed.sessionId !== sessionId) continue;
      const raw = this.storage.getItem(key);
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as DraftEntry;
        drafts.push({
          sessionId: parsed.sessionId,
          segmentId: parsed.segmentId,
          text: entry.text,
          savedAt: entry.savedAt,
        });
      } catch {
        // Skip invalid entries
      }
    }
    return drafts;
  }

  cleanExpiredDrafts(): number {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      const raw = this.storage.getItem(key);
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as DraftEntry;
        const savedTime = new Date(entry.savedAt).getTime();
        if (now - savedTime > EXPIRATION_MS) {
          keysToRemove.push(key);
        }
      } catch {
        // Remove invalid entries too
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.storage.removeItem(key);
    }

    return keysToRemove.length;
  }
}
