import type { Correction } from '../types/correction';

/**
 * Create a TEXT type Correction for a segment text change.
 * Returns null if beforeText === afterText (no change detected).
 * Generates correctionId (UUID) and createdAt (ISO 8601 UTC).
 */
export function createTextCorrection(
  sessionId: string,
  segmentId: string,
  userId: string,
  beforeText: string,
  afterText: string
): Correction | null {
  if (beforeText === afterText) {
    return null;
  }

  return {
    correctionId: crypto.randomUUID(),
    sessionId,
    segmentId,
    userId,
    correctionType: 'TEXT',
    beforeText,
    afterText,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create a SPEAKER type Correction for a single segment speaker change.
 * Returns null if beforeSpeaker === afterSpeaker (no change detected).
 * Uses the speaker labels as beforeText/afterText to satisfy the requirement
 * that all Corrections must include beforeText/afterText.
 */
export function createSpeakerCorrection(
  sessionId: string,
  segmentId: string,
  userId: string,
  beforeSpeaker: string,
  afterSpeaker: string
): Correction | null {
  if (beforeSpeaker === afterSpeaker) {
    return null;
  }

  return {
    correctionId: crypto.randomUUID(),
    sessionId,
    segmentId,
    userId,
    correctionType: 'SPEAKER',
    beforeText: beforeSpeaker,
    afterText: afterSpeaker,
    beforeSpeaker,
    afterSpeaker,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create a SPEAKER_RENAME type Correction for a bulk speaker label rename.
 * Always creates a Correction (rename is always a change).
 * Uses the speaker labels as beforeText/afterText.
 * correctionType: 'SPEAKER_RENAME'
 */
export function createSpeakerRenameCorrection(
  sessionId: string,
  userId: string,
  beforeLabel: string,
  afterLabel: string,
  affectedSegmentCount: number
): Correction {
  return {
    correctionId: crypto.randomUUID(),
    sessionId,
    segmentId: '',
    userId,
    correctionType: 'SPEAKER_RENAME',
    beforeText: beforeLabel,
    afterText: afterLabel,
    beforeSpeaker: beforeLabel,
    afterSpeaker: afterLabel,
    affectedSegmentCount,
    createdAt: new Date().toISOString(),
  };
}
