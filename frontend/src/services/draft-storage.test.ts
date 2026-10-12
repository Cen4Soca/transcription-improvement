import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DraftStorage } from './draft-storage';

describe('DraftStorage', () => {
  let storage: DraftStorage;
  let mockStorage: Storage;

  beforeEach(() => {
    // Create a simple in-memory storage mock
    const store: Record<string, string> = {};
    mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (index: number) => Object.keys(store)[index] ?? null,
    };
    storage = new DraftStorage(mockStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('saveDraft', () => {
    it('saves draft with correct key format', () => {
      storage.saveDraft('session1', 'segment1', 'hello world');

      const raw = mockStorage.getItem('draft_session1_segment1');
      expect(raw).not.toBeNull();
      const entry = JSON.parse(raw!);
      expect(entry.text).toBe('hello world');
      expect(entry.savedAt).toBeDefined();
    });

    it('saves draft with ISO 8601 timestamp', () => {
      const before = new Date().toISOString();
      storage.saveDraft('s1', 'seg1', 'text');
      const after = new Date().toISOString();

      const entry = storage.getDraft('s1', 'seg1');
      expect(entry).not.toBeNull();
      expect(entry!.savedAt >= before).toBe(true);
      expect(entry!.savedAt <= after).toBe(true);
    });

    it('overwrites existing draft for same session/segment', () => {
      storage.saveDraft('s1', 'seg1', 'first');
      storage.saveDraft('s1', 'seg1', 'second');

      const entry = storage.getDraft('s1', 'seg1');
      expect(entry!.text).toBe('second');
    });

    it('saves empty string text', () => {
      storage.saveDraft('s1', 'seg1', '');

      const entry = storage.getDraft('s1', 'seg1');
      expect(entry).not.toBeNull();
      expect(entry!.text).toBe('');
    });
  });

  describe('getDraft', () => {
    it('returns null for non-existent draft', () => {
      const result = storage.getDraft('nonexistent', 'segment');
      expect(result).toBeNull();
    });

    it('returns saved draft entry', () => {
      storage.saveDraft('s1', 'seg1', 'my text');

      const entry = storage.getDraft('s1', 'seg1');
      expect(entry).not.toBeNull();
      expect(entry!.text).toBe('my text');
      expect(entry!.savedAt).toBeDefined();
    });

    it('returns null for invalid JSON in storage', () => {
      mockStorage.setItem('draft_s1_seg1', 'not json');

      const result = storage.getDraft('s1', 'seg1');
      expect(result).toBeNull();
    });
  });

  describe('deleteDraft', () => {
    it('removes draft from storage', () => {
      storage.saveDraft('s1', 'seg1', 'text');
      storage.deleteDraft('s1', 'seg1');

      const result = storage.getDraft('s1', 'seg1');
      expect(result).toBeNull();
    });

    it('does not throw when deleting non-existent draft', () => {
      expect(() => storage.deleteDraft('nonexistent', 'segment')).not.toThrow();
    });
  });

  describe('getAllDrafts', () => {
    it('returns empty array when no drafts exist', () => {
      const result = storage.getAllDrafts('s1');
      expect(result).toEqual([]);
    });

    it('returns all drafts for a given session', () => {
      storage.saveDraft('s1', 'seg1', 'text1');
      storage.saveDraft('s1', 'seg2', 'text2');
      storage.saveDraft('s2', 'seg3', 'text3');

      const result = storage.getAllDrafts('s1');
      expect(result).toHaveLength(2);
      expect(result.map((d) => d.segmentId).sort()).toEqual(['seg1', 'seg2']);
    });

    it('does not return drafts from other sessions', () => {
      storage.saveDraft('s1', 'seg1', 'text1');
      storage.saveDraft('s2', 'seg2', 'text2');

      const result = storage.getAllDrafts('s1');
      expect(result).toHaveLength(1);
      expect(result[0].segmentId).toBe('seg1');
    });

    it('includes text and savedAt in returned drafts', () => {
      storage.saveDraft('s1', 'seg1', 'hello');

      const result = storage.getAllDrafts('s1');
      expect(result[0].text).toBe('hello');
      expect(result[0].savedAt).toBeDefined();
      expect(result[0].sessionId).toBe('s1');
      expect(result[0].segmentId).toBe('seg1');
    });
  });

  describe('cleanExpiredDrafts', () => {
    it('removes drafts older than 24 hours', () => {
      // Save a draft with a timestamp 25 hours ago
      const expiredTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mockStorage.setItem(
        'draft_s1_seg1',
        JSON.stringify({ text: 'old', savedAt: expiredTime })
      );

      const removed = storage.cleanExpiredDrafts();
      expect(removed).toBe(1);
      expect(storage.getDraft('s1', 'seg1')).toBeNull();
    });

    it('keeps drafts newer than 24 hours', () => {
      storage.saveDraft('s1', 'seg1', 'recent');

      const removed = storage.cleanExpiredDrafts();
      expect(removed).toBe(0);
      expect(storage.getDraft('s1', 'seg1')).not.toBeNull();
    });

    it('removes invalid JSON entries', () => {
      mockStorage.setItem('draft_s1_seg1', 'invalid json');

      const removed = storage.cleanExpiredDrafts();
      expect(removed).toBe(1);
    });

    it('does not affect non-draft keys', () => {
      mockStorage.setItem('other_key', 'value');
      storage.saveDraft('s1', 'seg1', 'text');

      storage.cleanExpiredDrafts();
      expect(mockStorage.getItem('other_key')).toBe('value');
    });

    it('returns count of removed entries', () => {
      const expiredTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mockStorage.setItem(
        'draft_s1_seg1',
        JSON.stringify({ text: 'old1', savedAt: expiredTime })
      );
      mockStorage.setItem(
        'draft_s1_seg2',
        JSON.stringify({ text: 'old2', savedAt: expiredTime })
      );
      storage.saveDraft('s1', 'seg3', 'recent');

      const removed = storage.cleanExpiredDrafts();
      expect(removed).toBe(2);
      expect(storage.getDraft('s1', 'seg3')).not.toBeNull();
    });

    it('does NOT delete drafts at exactly 24 hours', () => {
      // Exactly 24 hours = boundary, should NOT be expired
      const exactlyAt24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      mockStorage.setItem(
        'draft_s1_seg1',
        JSON.stringify({ text: 'boundary', savedAt: exactlyAt24h })
      );

      const removed = storage.cleanExpiredDrafts();
      expect(removed).toBe(0);
      expect(storage.getDraft('s1', 'seg1')).not.toBeNull();
    });

    it('deletes drafts just over 24 hours old', () => {
      // 24 hours + 1 millisecond = expired
      const justOver24h = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
      mockStorage.setItem(
        'draft_s1_seg1',
        JSON.stringify({ text: 'just expired', savedAt: justOver24h })
      );

      const removed = storage.cleanExpiredDrafts();
      expect(removed).toBe(1);
      expect(storage.getDraft('s1', 'seg1')).toBeNull();
    });
  });

  describe('draft restore round-trip', () => {
    it('restores saved text exactly as it was saved', () => {
      const originalText = '修正テキスト with special chars: <>&"\'';
      storage.saveDraft('s1', 'seg1', originalText);

      const restored = storage.getDraft('s1', 'seg1');
      expect(restored).not.toBeNull();
      expect(restored!.text).toBe(originalText);
    });

    it('handles multiple segments for the same session independently', () => {
      storage.saveDraft('s1', 'seg1', 'text for seg1');
      storage.saveDraft('s1', 'seg2', 'text for seg2');
      storage.saveDraft('s1', 'seg3', 'text for seg3');

      expect(storage.getDraft('s1', 'seg1')!.text).toBe('text for seg1');
      expect(storage.getDraft('s1', 'seg2')!.text).toBe('text for seg2');
      expect(storage.getDraft('s1', 'seg3')!.text).toBe('text for seg3');
    });

    it('deleting a draft for one segment does not affect others', () => {
      storage.saveDraft('s1', 'seg1', 'text1');
      storage.saveDraft('s1', 'seg2', 'text2');

      storage.deleteDraft('s1', 'seg1');

      expect(storage.getDraft('s1', 'seg1')).toBeNull();
      expect(storage.getDraft('s1', 'seg2')!.text).toBe('text2');
    });
  });
});
