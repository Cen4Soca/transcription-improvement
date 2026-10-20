import { type AuthUser } from '../utils/auth-middleware.js';
import { validationError, internalError } from '../utils/error-handler.js';
import {
  saveCorrection,
  updateSessionStatusToInProgress,
  type CorrectionRecord,
} from '../repositories/correction-repository.js';
import { addParticipant, getSessionById } from '../repositories/session-repository.js';
import { assertSessionEditable } from '../utils/session-guard.js';

export interface CreateCorrectionInput {
  correctionId: string;
  segmentId: string;
  correctionType: 'TEXT' | 'SPEAKER' | 'SPEAKER_RENAME';
  beforeText: string;
  afterText: string;
  beforeSpeaker?: string;
  afterSpeaker?: string;
  affectedSegmentCount?: number;
}

export interface CreateCorrectionResult {
  correction: CorrectionRecord;
  isDuplicate: boolean;
}

const VALID_CORRECTION_TYPES = ['TEXT', 'SPEAKER', 'SPEAKER_RENAME'] as const;

/**
 * Validate the correction request body.
 * Throws a validation error if required fields are missing or invalid.
 */
export function validateCorrectionInput(body: unknown): CreateCorrectionInput {
  if (!body || typeof body !== 'object') {
    throw validationError('リクエストボディが不正です。');
  }

  const input = body as Record<string, unknown>;

  if (!input.correctionId || typeof input.correctionId !== 'string') {
    throw validationError('correctionId は必須です。');
  }

  // segmentId must be a string, but an empty string is valid: SPEAKER_RENAME is a
  // bulk operation not tied to a specific segment and sends segmentId: ''.
  // Using `!input.segmentId` here dropped those requests (empty string is falsy).
  if (typeof input.segmentId !== 'string') {
    throw validationError('segmentId は必須です。');
  }

  if (
    !input.correctionType ||
    !VALID_CORRECTION_TYPES.includes(input.correctionType as typeof VALID_CORRECTION_TYPES[number])
  ) {
    throw validationError(
      'correctionType は TEXT, SPEAKER, SPEAKER_RENAME のいずれかである必要があります。'
    );
  }

  if (typeof input.beforeText !== 'string') {
    throw validationError('beforeText は必須です。');
  }

  if (typeof input.afterText !== 'string') {
    throw validationError('afterText は必須です。');
  }

  return {
    correctionId: input.correctionId as string,
    segmentId: input.segmentId as string,
    correctionType: input.correctionType as CreateCorrectionInput['correctionType'],
    beforeText: input.beforeText as string,
    afterText: input.afterText as string,
    beforeSpeaker: typeof input.beforeSpeaker === 'string' ? input.beforeSpeaker : undefined,
    afterSpeaker: typeof input.afterSpeaker === 'string' ? input.afterSpeaker : undefined,
    affectedSegmentCount:
      typeof input.affectedSegmentCount === 'number' ? input.affectedSegmentCount : undefined,
  };
}

/**
 * Create and persist a Correction.
 *
 * Steps:
 * 1. Generate ISO 8601 UTC timestamp
 * 2. Save correction to DynamoDB (idempotent via correctionId)
 * 3. If this is the first correction for the session, update session status to IN_PROGRESS
 */
export async function createCorrection(
  sessionId: string,
  user: AuthUser,
  input: CreateCorrectionInput
): Promise<CreateCorrectionResult> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw validationError('指定されたセッションが見つかりません。');
  }
  assertSessionEditable(session);

  const createdAt = new Date().toISOString();

  const record: CorrectionRecord = {
    correctionId: input.correctionId,
    sessionId,
    segmentId: input.segmentId,
    userId: user.userId,
    correctionType: input.correctionType,
    beforeText: input.beforeText,
    afterText: input.afterText,
    beforeSpeaker: input.beforeSpeaker,
    afterSpeaker: input.afterSpeaker,
    affectedSegmentCount: input.affectedSegmentCount,
    createdAt,
  };

  try {
    const result = await saveCorrection(record);

    if (result.duplicate) {
      return { correction: record, isDuplicate: true };
    }

    // Ensure the submitting reviewer is registered as a session participant so
    // their correction is counted toward consensus (idempotent — a reviewer who
    // already joined is not double-counted).
    await addParticipant(sessionId, user.userId);

    // Always attempt to update session status to IN_PROGRESS.
    // The conditional update is idempotent — it only succeeds if status is PENDING.
    await updateSessionStatusToInProgress(sessionId);

    return { correction: record, isDuplicate: false };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AppError') {
      throw error;
    }
    throw internalError(
      '修正内容の保存に失敗しました。',
      error instanceof Error ? error.message : undefined
    );
  }
}
