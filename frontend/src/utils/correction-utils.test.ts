import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTextCorrection,
  createSpeakerCorrection,
  createSpeakerRenameCorrection,
} from './correction-utils';

describe('correction-utils', () => {
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
      const result = createTextCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'original text',
        'corrected text'
      );

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

    it('returns null when beforeText equals afterText (no change)', () => {
      const result = createTextCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'same text',
        'same text'
      );

      expect(result).toBeNull();
    });

    it('creates a correction for empty string to non-empty change', () => {
      const result = createTextCorrection(
        'session-1',
        'segment-1',
        'user-1',
        '',
        'new text'
      );

      expect(result).not.toBeNull();
      expect(result!.beforeText).toBe('');
      expect(result!.afterText).toBe('new text');
    });

    it('creates a correction for non-empty to empty string change', () => {
      const result = createTextCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'some text',
        ''
      );

      expect(result).not.toBeNull();
      expect(result!.beforeText).toBe('some text');
      expect(result!.afterText).toBe('');
    });

    it('returns null when both beforeText and afterText are empty', () => {
      const result = createTextCorrection(
        'session-1',
        'segment-1',
        'user-1',
        '',
        ''
      );

      expect(result).toBeNull();
    });

    it('generates a UUID for correctionId', () => {
      const result = createTextCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'before',
        'after'
      );

      expect(result!.correctionId).toBe(fixedUUID);
    });

    it('sets createdAt to ISO 8601 UTC format', () => {
      const result = createTextCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'before',
        'after'
      );

      expect(result!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('createSpeakerCorrection', () => {
    it('creates a SPEAKER correction with speaker info and uses labels as text', () => {
      const result = createSpeakerCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'spk_0',
        'spk_1'
      );

      expect(result).not.toBeNull();
      expect(result!.correctionType).toBe('SPEAKER');
      expect(result!.beforeText).toBe('spk_0');
      expect(result!.afterText).toBe('spk_1');
      expect(result!.beforeSpeaker).toBe('spk_0');
      expect(result!.afterSpeaker).toBe('spk_1');
      expect(result!.createdAt).toBe(fixedDate);
    });

    it('returns null when beforeSpeaker equals afterSpeaker (no change)', () => {
      const result = createSpeakerCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'spk_0',
        'spk_0'
      );

      expect(result).toBeNull();
    });

    it('always includes beforeText and afterText (using speaker labels)', () => {
      const result = createSpeakerCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'Speaker A',
        'Speaker B'
      );

      expect(result).not.toBeNull();
      expect(result!.beforeText).toBe('Speaker A');
      expect(result!.afterText).toBe('Speaker B');
    });

    it('generates a UUID for correctionId', () => {
      const result = createSpeakerCorrection(
        'session-1',
        'segment-1',
        'user-1',
        'spk_0',
        'spk_1'
      );

      expect(result!.correctionId).toBe(fixedUUID);
    });
  });

  describe('createSpeakerRenameCorrection', () => {
    it('creates a SPEAKER_RENAME correction with affectedSegmentCount', () => {
      const result = createSpeakerRenameCorrection(
        'session-1',
        'user-1',
        'spk_0',
        'Speaker Name',
        5
      );

      expect(result.correctionType).toBe('SPEAKER_RENAME');
      expect(result.beforeText).toBe('spk_0');
      expect(result.afterText).toBe('Speaker Name');
      expect(result.beforeSpeaker).toBe('spk_0');
      expect(result.afterSpeaker).toBe('Speaker Name');
      expect(result.affectedSegmentCount).toBe(5);
      expect(result.createdAt).toBe(fixedDate);
    });

    it('always creates a correction (rename is always a change)', () => {
      const result = createSpeakerRenameCorrection(
        'session-1',
        'user-1',
        'same_label',
        'same_label',
        3
      );

      // Even if labels are the same, rename always creates a correction
      expect(result).not.toBeNull();
      expect(result.correctionType).toBe('SPEAKER_RENAME');
    });

    it('uses labels as beforeText and afterText', () => {
      const result = createSpeakerRenameCorrection(
        'session-1',
        'user-1',
        'old_label',
        'new_label',
        10
      );

      expect(result.beforeText).toBe('old_label');
      expect(result.afterText).toBe('new_label');
    });

    it('generates a UUID for correctionId', () => {
      const result = createSpeakerRenameCorrection(
        'session-1',
        'user-1',
        'a',
        'b',
        1
      );

      expect(result.correctionId).toBe(fixedUUID);
    });

    it('sets createdAt to ISO 8601 UTC format', () => {
      const result = createSpeakerRenameCorrection(
        'session-1',
        'user-1',
        'a',
        'b',
        1
      );

      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
