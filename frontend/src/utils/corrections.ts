import type { Correction, CorrectionType } from '../types/correction';

export interface TextCorrectionParams {
  sessionId: string;
  segmentId: string;
  userId: string;
  beforeText: string;
  afterText: string;
}

export interface SpeakerCorrectionParams {
  sessionId: string;
  segmentId: string;
  userId: string;
  beforeText: string;
  afterText: string;
  beforeSpeaker: string;
  afterSpeaker: string;
}

export interface SpeakerRenameCorrectionParams {
  sessionId: string;
  segmentId: string;
  userId: string;
  beforeText: string;
  afterText: string;
  beforeSpeaker: string;
  afterSpeaker: string;
  affectedSegmentCount: number;
}

/**
 * Create a TEXT type Correction for a segment text change.
 * Returns null if beforeText === afterText (no change detected).
 */
export function createTextCorrection(params: TextCorrectionParams): Correction | null {
  if (params.beforeText === params.afterText) {
    return null;
  }

  return buildCorrection({
    ...params,
    correctionType: 'TEXT',
  });
}

/**
 * Create a SPEAKER type Correction for a single segment speaker change.
 * Returns null if beforeSpeaker === afterSpeaker (no change detected).
 */
export function createSpeakerCorrection(params: SpeakerCorrectionParams): Correction | null {
  if (params.beforeSpeaker === params.afterSpeaker) {
    return null;
  }

  return buildCorrection({
    ...params,
    correctionType: 'SPEAKER',
  });
}

/**
 * Create a SPEAKER_RENAME type Correction for a bulk speaker label rename.
 * Always creates a Correction (rename implies a change was intended).
 */
export function createSpeakerRenameCorrection(params: SpeakerRenameCorrectionParams): Correction {
  return buildCorrection({
    ...params,
    correctionType: 'SPEAKER_RENAME',
  });
}

interface BuildCorrectionParams {
  sessionId: string;
  segmentId: string;
  userId: string;
  correctionType: CorrectionType;
  beforeText: string;
  afterText: string;
  beforeSpeaker?: string;
  afterSpeaker?: string;
  affectedSegmentCount?: number;
}

function buildCorrection(params: BuildCorrectionParams): Correction {
  return {
    correctionId: crypto.randomUUID(),
    sessionId: params.sessionId,
    segmentId: params.segmentId,
    userId: params.userId,
    correctionType: params.correctionType,
    beforeText: params.beforeText,
    afterText: params.afterText,
    beforeSpeaker: params.beforeSpeaker,
    afterSpeaker: params.afterSpeaker,
    affectedSegmentCount: params.affectedSegmentCount,
    createdAt: new Date().toISOString(),
  };
}
