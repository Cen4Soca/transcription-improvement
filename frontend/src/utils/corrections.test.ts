import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTextCorrection,
  createSpeakerCorrection,
  createSpeakerRenameCorrection,
} from './corrections';

describe('corrections', () => {
  const fixedUUID = '550e8400-e29b-41d4-a716-446655440000';
  const fixedDate = '2024-06-15T10:30:00.000Z';

  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: () => fixedUUID,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixedDate));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('createTextCorrection', () => {
    it('creates a TEXT correction with beforeText and afterText', () => {
      const result = createTextCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'original text',
        afterText: 'corrected text',
      });

      expect(result).not.toBeNull();
      expect(result!.correctionId).toBe(fixedUUID);
      expect(result!.sessionId).toBe('session-1');
      expect(result!.segmentId).toBe('segment-1');
      expect(result!.userId).toBe('user-1');
      expect(result!.correctionType).toBe('TEXT');
      expect(result!.beforeText).toBe('original text');
      expect(result!.afterText).toBe('corrected text');
      expect(result!.createdAt).toBe(fixedDate);
    });

    it('returns null when beforeText equals afterText', () => {
      const result = createTextCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'same text',
        afterText: 'same text',
      });

      expect(result).toBeNull();
    });

    it('creates a correction for empty string to non-empty change', () => {
      const result = createTextCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: '',
        afterText: 'new text',
      });

      expect(result).not.toBeNull();
      expect(result!.beforeText).toBe('');
      expect(result!.afterText).toBe('new text');
    });

    it('creates a correction for non-empty to empty string change', () => {
      const result = createTextCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'some text',
        afterText: '',
      });

      expect(result).not.toBeNull();
      expect(result!.beforeText).toBe('some text');
      expect(result!.afterText).toBe('');
    });

    it('returns null when both beforeText and afterText are empty', () => {
      const result = createTextCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: '',
        afterText: '',
      });

      expect(result).toBeNull();
    });
  });

  describe('createSpeakerCorrection', () => {
    it('creates a SPEAKER correction with speaker info', () => {
      const result = createSpeakerCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'segment text',
        afterText: 'segment text',
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'spk_1',
      });

      expect(result).not.toBeNull();
      expect(result!.correctionType).toBe('SPEAKER');
      expect(result!.beforeText).toBe('segment text');
      expect(result!.afterText).toBe('segment text');
      expect(result!.beforeSpeaker).toBe('spk_0');
      expect(result!.afterSpeaker).toBe('spk_1');
      expect(result!.createdAt).toBe(fixedDate);
    });

    it('returns null when beforeSpeaker equals afterSpeaker', () => {
      const result = createSpeakerCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'segment text',
        afterText: 'segment text',
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'spk_0',
      });

      expect(result).toBeNull();
    });

    it('always includes beforeText and afterText', () => {
      const result = createSpeakerCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'the text content',
        afterText: 'the text content',
        beforeSpeaker: 'Speaker A',
        afterSpeaker: 'Speaker B',
      });

      expect(result).not.toBeNull();
      expect(result!.beforeText).toBe('the text content');
      expect(result!.afterText).toBe('the text content');
    });
  });

  describe('createSpeakerRenameCorrection', () => {
    it('creates a SPEAKER_RENAME correction with affectedSegmentCount', () => {
      const result = createSpeakerRenameCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'segment text',
        afterText: 'segment text',
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'Speaker Name',
        affectedSegmentCount: 5,
      });

      expect(result.correctionType).toBe('SPEAKER_RENAME');
      expect(result.beforeText).toBe('segment text');
      expect(result.afterText).toBe('segment text');
      expect(result.beforeSpeaker).toBe('spk_0');
      expect(result.afterSpeaker).toBe('Speaker Name');
      expect(result.affectedSegmentCount).toBe(5);
      expect(result.createdAt).toBe(fixedDate);
    });

    it('always includes beforeText and afterText', () => {
      const result = createSpeakerRenameCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'original',
        afterText: 'original',
        beforeSpeaker: 'old_label',
        afterSpeaker: 'new_label',
        affectedSegmentCount: 10,
      });

      expect(result.beforeText).toBe('original');
      expect(result.afterText).toBe('original');
    });

    it('generates a UUID for correctionId', () => {
      const result = createSpeakerRenameCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'text',
        afterText: 'text',
        beforeSpeaker: 'a',
        afterSpeaker: 'b',
        affectedSegmentCount: 3,
      });

      expect(result.correctionId).toBe(fixedUUID);
    });

    it('sets createdAt to ISO 8601 UTC format', () => {
      const result = createSpeakerRenameCorrection({
        sessionId: 'session-1',
        segmentId: 'segment-1',
        userId: 'user-1',
        beforeText: 'text',
        afterText: 'text',
        beforeSpeaker: 'a',
        afterSpeaker: 'b',
        affectedSegmentCount: 1,
      });

      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
