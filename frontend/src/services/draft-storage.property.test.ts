import { describe, test, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DraftStorage } from './draft-storage';

/**
 * In-memory mock localStorage for testing
 */
class MockStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const sessionIdArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);
const segmentIdArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);
const draftTextArb = fc.string({ minLength: 0, maxLength: 500 });

describe('Feature: transcription-review-app, Property 43: 自動保存ドラフトの復元', () => {
  let mockStorage: MockStorage;
  let draftStorage: DraftStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
    draftStorage = new DraftStorage(mockStorage);
  });

  /**
   * **Validates: Requirements 11.9**
   *
   * Any text saved via saveDraft can be retrieved via getDraft (round-trip).
   * The retrieved text matches the saved text exactly.
   */
  test('saveDraftで保存したテキストはgetDraftで取得できる（ラウンドトリップ）', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        segmentIdArb,
        draftTextArb,
        (sessionId, segmentId, text) => {
          draftStorage.saveDraft(sessionId, segmentId, text);
          const retrieved = draftStorage.getDraft(sessionId, segmentId);

          expect(retrieved).not.toBeNull();
          expect(retrieved!.text).toBe(text);
          expect(retrieved!.savedAt).toBeTruthy();
          // savedAt should be a valid ISO 8601 timestamp
          expect(new Date(retrieved!.savedAt).toISOString()).toBe(retrieved!.savedAt);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.9**
   *
   * deleteDraft removes the entry — getDraft returns null after delete.
   */
  test('deleteDraftで削除後、getDraftはnullを返す', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        segmentIdArb,
        draftTextArb,
        (sessionId, segmentId, text) => {
          draftStorage.saveDraft(sessionId, segmentId, text);
          // Verify it exists
          expect(draftStorage.getDraft(sessionId, segmentId)).not.toBeNull();

          // Delete it
          draftStorage.deleteDraft(sessionId, segmentId);

          // Verify it's gone
          expect(draftStorage.getDraft(sessionId, segmentId)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.9**
   *
   * Expired drafts (>24h) are cleaned by cleanExpiredDrafts.
   * Drafts older than 24 hours are removed, while recent drafts remain.
   */
  test('24時間超過のドラフトはcleanExpiredDraftsで削除される', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        segmentIdArb,
        draftTextArb,
        (sessionId, segmentId, text) => {
          // Manually insert an expired draft (25 hours ago)
          const expiredTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
          const key = `draft_${sessionId}_${segmentId}`;
          mockStorage.setItem(key, JSON.stringify({ text, savedAt: expiredTime }));

          // Verify it exists in storage
          expect(mockStorage.getItem(key)).not.toBeNull();

          // Clean expired drafts
          const cleaned = draftStorage.cleanExpiredDrafts();

          // The expired draft should be removed
          expect(cleaned).toBeGreaterThanOrEqual(1);
          expect(draftStorage.getDraft(sessionId, segmentId)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.9**
   *
   * getAllDrafts returns all drafts for a given session.
   * After saving N drafts for a session, getAllDrafts returns exactly N entries.
   */
  test('getAllDraftsは指定セッションの全ドラフトを返す', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        fc.uniqueArray(segmentIdArb, { minLength: 1, maxLength: 10 }),
        fc.array(draftTextArb, { minLength: 1, maxLength: 10 }),
        (sessionId, segmentIds, texts) => {
          // Use a fresh storage for each property run to avoid cross-contamination
          const localStorage = new MockStorage();
          const localDraftStorage = new DraftStorage(localStorage);

          // Use the shorter array length to pair segmentIds with texts
          const count = Math.min(segmentIds.length, texts.length);

          for (let i = 0; i < count; i++) {
            localDraftStorage.saveDraft(sessionId, segmentIds[i], texts[i]);
          }

          const allDrafts = localDraftStorage.getAllDrafts(sessionId);

          expect(allDrafts.length).toBe(count);

          // Each saved draft should be present in the result
          for (let i = 0; i < count; i++) {
            const found = allDrafts.find(d => d.segmentId === segmentIds[i]);
            expect(found).toBeDefined();
            expect(found!.text).toBe(texts[i]);
            expect(found!.sessionId).toBe(sessionId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
