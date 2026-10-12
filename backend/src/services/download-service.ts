import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import { notFoundError, validationError } from '../utils/error-handler.js';
import * as sessionRepository from '../repositories/session-repository.js';
import { getCorrections } from '../repositories/correction-repository.js';

// --- Interfaces ---

export interface DownloadSegment {
  segmentId: string;
  startTime: number;
  endTime: number;
  text: string;
  speakerLabel?: string;
  consensusStatus: 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT';
}

export interface TranscriptionJsonSegment {
  startTime: number;
  endTime: number;
  text: string;
  speakerLabel?: string;
}

export interface TranscriptionJson {
  sessionName: string;
  exportedAt: string;
  segments: TranscriptionJsonSegment[];
}

// --- Pure Functions (exported for property testing) ---

/**
 * Filter segments to only include those with consensusStatus === 'CONFIRMED'.
 * Pure function — no side effects.
 */
export function filterConfirmedSegments(segments: DownloadSegment[]): DownloadSegment[] {
  return segments.filter((segment) => segment.consensusStatus === 'CONFIRMED');
}

/**
 * A speaker-label correction to apply to download output.
 * - 'SPEAKER': single-segment speaker change (targets a specific segmentId)
 * - 'SPEAKER_RENAME': bulk rename of a label across all segments
 */
export interface SpeakerCorrection {
  correctionType: 'SPEAKER' | 'SPEAKER_RENAME';
  segmentId?: string;
  beforeSpeaker?: string;
  afterSpeaker?: string;
}

/**
 * Apply a user's speaker-label corrections to segments for download output.
 * Pure function — no side effects; returns a new array.
 *
 * Apply order mirrors the review screen (ReviewPage):
 *   1. Bulk renames (SPEAKER_RENAME) in recorded order, following rename chains (A→B→C)
 *   2. Per-segment speaker changes (SPEAKER), which take precedence over bulk renames
 *
 * @param segments - Segments to transform (order preserved)
 * @param corrections - The user's speaker corrections, in chronological order
 */
export function applySpeakerCorrections(
  segments: DownloadSegment[],
  corrections: SpeakerCorrection[],
): DownloadSegment[] {
  if (corrections.length === 0) return segments;

  // Build the bulk-rename chain map (oldLabel -> newLabel).
  const renameMap = new Map<string, string>();
  const perSegment = new Map<string, string>();

  for (const c of corrections) {
    if (
      c.correctionType === 'SPEAKER_RENAME' &&
      c.beforeSpeaker !== undefined &&
      c.afterSpeaker !== undefined
    ) {
      renameMap.set(c.beforeSpeaker, c.afterSpeaker);
    } else if (
      c.correctionType === 'SPEAKER' &&
      c.segmentId &&
      c.afterSpeaker !== undefined
    ) {
      // Later per-segment corrections win (chronological order)
      perSegment.set(c.segmentId, c.afterSpeaker);
    }
  }

  const resolveLabel = (label: string): string => {
    let current = label;
    // Follow rename chains, bounded to avoid infinite loops on cycles.
    for (let i = 0; i <= renameMap.size && renameMap.has(current); i++) {
      current = renameMap.get(current)!;
    }
    return current;
  };

  return segments.map((segment) => {
    let speaker = segment.speakerLabel;
    if (speaker && renameMap.size > 0) {
      speaker = resolveLabel(speaker);
    }
    if (perSegment.has(segment.segmentId)) {
      speaker = perSegment.get(segment.segmentId);
    }
    if (speaker === segment.speakerLabel) return segment;
    return { ...segment, speakerLabel: speaker };
  });
}

/**
 * Generate a TranscriptionJson object from confirmed segments.
 * Pure function — no side effects.
 *
 * @param sessionName - The name of the ReviewSession
 * @param segments - Array of confirmed segments (must be non-empty)
 * @param exportedAt - ISO 8601 timestamp for the export time
 */
export function generateTranscriptionJson(
  sessionName: string,
  segments: DownloadSegment[],
  exportedAt: string,
): TranscriptionJson {
  return {
    sessionName,
    exportedAt,
    segments: segments.map((segment) => ({
      startTime: segment.startTime,
      endTime: segment.endTime,
      text: segment.text,
      ...(segment.speakerLabel ? { speakerLabel: segment.speakerLabel } : {}),
    })),
  };
}

/**
 * Format a time value in seconds to SRT timecode format: HH:MM:SS,mmm
 * Pure function — no side effects.
 */
export function formatSrtTimecode(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(secs).padStart(2, '0') +
    ',' +
    String(ms).padStart(3, '0')
  );
}

/**
 * Generate SRT format string from confirmed segments.
 * Pure function — no side effects.
 *
 * SRT format:
 * ```
 * 1
 * 00:00:00,000 --> 00:00:03,500
 * [spk_0] テキスト
 *
 * 2
 * 00:00:04,000 --> 00:00:07,200
 * テキスト（話者ラベルなし）
 * ```
 *
 * @param segments - Array of confirmed segments (must be non-empty)
 */
export function generateTranscriptionSrt(segments: DownloadSegment[]): string {
  return segments
    .map((segment, index) => {
      const sequenceNumber = index + 1;
      const startTimecode = formatSrtTimecode(segment.startTime);
      const endTimecode = formatSrtTimecode(segment.endTime);
      const textLine = segment.speakerLabel
        ? `[${segment.speakerLabel}] ${segment.text}`
        : segment.text;

      return `${sequenceNumber}\n${startTimecode} --> ${endTimecode}\n${textLine}`;
    })
    .join('\n\n');
}

/**
 * Generate a download filename in the format: {ReviewSession名}_{YYYYMMDD}.{拡張子}
 * Pure function — no side effects.
 *
 * @param sessionName - The name of the ReviewSession
 * @param date - The download date
 * @param extension - File extension (e.g., 'json', 'srt')
 */
export function generateDownloadFilename(
  sessionName: string,
  date: Date,
  extension: string,
): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  return `${sessionName}_${dateStr}.${extension}`;
}

// --- Service Functions ---

/**
 * Get all segments for a session from DynamoDB.
 * Returns segments with their consensus status and text.
 */
async function getSessionSegments(sessionId: string): Promise<DownloadSegment[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'SEGMENT#',
      },
      ScanIndexForward: true,
    }),
  );

  return (result.Items ?? []).map((item) => ({
    segmentId: item['segmentId'] as string,
    startTime: item['startTime'] as number,
    endTime: item['endTime'] as number,
    text: (item['consensusText'] as string) ?? (item['originalText'] as string),
    speakerLabel: item['speakerLabel'] as string | undefined,
    consensusStatus:
      (item['consensusStatus'] as 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT') ?? 'UNDECIDED',
  }));
}

/**
 * Load the requesting user's speaker-label corrections for a session.
 * Only SPEAKER / SPEAKER_RENAME corrections are returned, in chronological order.
 * Speaker changes are personal (not shared with other reviewers), so this queries
 * only the requesting user's corrections.
 */
async function getUserSpeakerCorrections(
  sessionId: string,
  userId: string,
): Promise<SpeakerCorrection[]> {
  const corrections = await getCorrections(sessionId, userId);
  return corrections
    .filter(
      (c) => c.correctionType === 'SPEAKER' || c.correctionType === 'SPEAKER_RENAME',
    )
    .map((c) => ({
      correctionType: c.correctionType as 'SPEAKER' | 'SPEAKER_RENAME',
      segmentId: c.segmentId,
      beforeSpeaker: c.beforeSpeaker,
      afterSpeaker: c.afterSpeaker,
    }));
}

/**
 * Generate JSON format transcription for download.
 * Queries DynamoDB for session and segment data, filters to confirmed segments only.
 * Applies the requesting user's speaker-label changes to the output (Req 2.14, 19).
 *
 * @param sessionId - The ReviewSession id
 * @param userId - The requesting user's id (for applying their speaker corrections)
 * @throws AppError with code NO_CONFIRMED_SEGMENTS if no confirmed segments exist
 * @throws AppError with code NOT_FOUND if session does not exist
 */
export async function generateJson(
  sessionId: string,
  userId?: string,
): Promise<TranscriptionJson> {
  const session = await sessionRepository.getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定された ReviewSession が見つかりません。');
  }

  const allSegments = await getSessionSegments(sessionId);
  let confirmedSegments = filterConfirmedSegments(allSegments);

  if (confirmedSegments.length === 0) {
    throw validationError('確定済みの Segment がありません。');
  }

  if (userId) {
    const speakerCorrections = await getUserSpeakerCorrections(sessionId, userId);
    confirmedSegments = applySpeakerCorrections(confirmedSegments, speakerCorrections);
  }

  const exportedAt = new Date().toISOString();
  return generateTranscriptionJson(session.name, confirmedSegments, exportedAt);
}

/**
 * Generate SRT format transcription for download.
 * Queries DynamoDB for session and segment data, filters to confirmed segments only.
 * Applies the requesting user's speaker-label changes to the output (Req 2.14, 19).
 *
 * @param sessionId - The ReviewSession id
 * @param userId - The requesting user's id (for applying their speaker corrections)
 * @throws AppError with code NO_CONFIRMED_SEGMENTS if no confirmed segments exist
 * @throws AppError with code NOT_FOUND if session does not exist
 */
export async function generateSrt(
  sessionId: string,
  userId?: string,
): Promise<string> {
  const session = await sessionRepository.getSessionById(sessionId);
  if (!session) {
    throw notFoundError('指定された ReviewSession が見つかりません。');
  }

  const allSegments = await getSessionSegments(sessionId);
  let confirmedSegments = filterConfirmedSegments(allSegments);

  if (confirmedSegments.length === 0) {
    throw validationError('確定済みの Segment がありません。');
  }

  if (userId) {
    const speakerCorrections = await getUserSpeakerCorrections(sessionId, userId);
    confirmedSegments = applySpeakerCorrections(confirmedSegments, speakerCorrections);
  }

  return generateTranscriptionSrt(confirmedSegments);
}
