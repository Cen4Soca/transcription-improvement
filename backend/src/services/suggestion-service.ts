import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  ComprehendClient,
  DetectKeyPhrasesCommand,
  DetectEntitiesCommand,
  type LanguageCode,
} from '@aws-sdk/client-comprehend';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import { resolveBedrockRegion } from '../utils/bedrock-region.js';
import { inferenceControlParams } from '../utils/bedrock-model-features.js';
import {
  getSessionSegments,
  type SegmentSummary,
} from '../repositories/segment-repository.js';
import { getSessionById } from '../repositories/session-repository.js';

/**
 * Suggestion source types indicating where a candidate originated.
 */
export type SuggestionSource = 'history' | 'bedrock' | 'comprehend';

/**
 * A single suggestion candidate with text and source information.
 */
export interface SuggestionCandidate {
  text: string;
  source: SuggestionSource;
}

/**
 * Result of the suggestion generation process.
 */
export interface SuggestionResult {
  suggestions: SuggestionCandidate[];
  hasExternalApiError: boolean;
}

/**
 * Interface for Bedrock (Claude) suggestion provider.
 * Mock-friendly for testing.
 */
export interface BedrockSuggestionProvider {
  getSuggestions(originalText: string, context?: string): Promise<SuggestionCandidate[]>;
}

/**
 * Interface for Comprehend suggestion provider.
 * Mock-friendly for testing.
 */
export interface ComprehendSuggestionProvider {
  getSuggestions(originalText: string): Promise<SuggestionCandidate[]>;
}

const MAX_SUGGESTIONS = 5;

/**
 * Merge suggestion candidates from multiple sources with priority ordering.
 * Priority: CorrectionHistory → Bedrock → Comprehend
 * Deduplicates by normalized text content (trimmed, case-sensitive).
 *
 * @param historyCandidates - Candidates from past correction history
 * @param bedrockCandidates - Candidates from Bedrock (Claude)
 * @param comprehendCandidates - Candidates from Comprehend
 * @returns Merged and deduplicated candidates in priority order
 */
export function mergeSuggestions(
  historyCandidates: SuggestionCandidate[],
  bedrockCandidates: SuggestionCandidate[],
  comprehendCandidates: SuggestionCandidate[]
): SuggestionCandidate[] {
  const seen = new Set<string>();
  const merged: SuggestionCandidate[] = [];

  const addCandidates = (candidates: SuggestionCandidate[]) => {
    for (const candidate of candidates) {
      const normalizedText = candidate.text.trim();
      if (normalizedText === '') continue;
      if (!seen.has(normalizedText)) {
        seen.add(normalizedText);
        merged.push({ text: normalizedText, source: candidate.source });
      }
    }
  };

  addCandidates(historyCandidates);
  addCandidates(bedrockCandidates);
  addCandidates(comprehendCandidates);

  return merged;
}

/**
 * Limit the number of suggestion candidates to a maximum count.
 *
 * @param candidates - Full list of candidates
 * @param max - Maximum number of candidates to return
 * @returns Truncated list of candidates
 */
export function limitSuggestions(
  candidates: SuggestionCandidate[],
  max: number = MAX_SUGGESTIONS
): SuggestionCandidate[] {
  return candidates.slice(0, max);
}

/**
 * Query CorrectionHistory from DynamoDB for past corrections on the same segment.
 * Returns unique afterText values as history-based suggestion candidates.
 */
export async function getCorrectionHistoryCandidates(
  segmentId: string
): Promise<SuggestionCandidate[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `SEGMENT#${segmentId}`,
        ':prefix': 'CORRECTION#',
      },
      ScanIndexForward: false,
    })
  );

  const seen = new Set<string>();
  const candidates: SuggestionCandidate[] = [];

  for (const item of result.Items ?? []) {
    const afterText = (item['afterText'] as string) ?? '';
    const trimmed = afterText.trim();
    if (trimmed !== '' && !seen.has(trimmed)) {
      seen.add(trimmed);
      candidates.push({ text: trimmed, source: 'history' });
    }
  }

  return candidates;
}

// --- External API configuration ---

/**
 * Bedrock model ID used for suggestion generation.
 *
 * Defaults to the JP cross-region inference profile for Claude Haiku 4.5.
 * In ap-northeast-1 (Tokyo), Anthropic foundation models only support the
 * INFERENCE_PROFILE inference type — invoking a bare foundation-model ID fails
 * with a ValidationException ("on-demand throughput isn't supported"). The
 * older Claude 3 / 3.5 profiles are now Legacy/EOL in this account, so Haiku
 * 4.5 is the current fast, cost-effective choice that is actually enabled.
 * Must match the model ID granted in infra (`api-stack.ts` / `bedrock-comprehend.ts`).
 */
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';

/** Comprehend language code for the transcription domain (Japanese). */
const COMPREHEND_LANGUAGE_CODE: LanguageCode =
  (process.env.COMPREHEND_LANGUAGE_CODE as LanguageCode) ?? 'ja';

/** Max suggestions requested from Bedrock in a single prompt. */
const BEDROCK_MAX_CANDIDATES = 3;

/**
 * Maximum total length (characters) of the surrounding-segment context injected
 * into the Bedrock prompt. Bounds prompt size / cost. Mirrors the 2000-char cap
 * used by session-name-suggestion-service's MAX_TRANSCRIPT_LENGTH.
 */
const MAX_CONTEXT_LENGTH = 2000;

/** Marker appended to the target segment line so Claude can locate the segment under review. */
const TARGET_SEGMENT_MARKER = '  ← 修正対象のセグメント';

// --- Lazily-initialized AWS SDK clients (reused across warm invocations) ---

let bedrockClient: BedrockRuntimeClient | undefined;
let comprehendClient: ComprehendClient | undefined;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    // Target the Bedrock endpoint in the inference profile's source region
    // (e.g. eu-central-1 for an `eu.` profile). Falls back to the SDK default
    // (Lambda execution region) when the model ID has no supported geo prefix.
    const region = resolveBedrockRegion(BEDROCK_MODEL_ID);
    bedrockClient = new BedrockRuntimeClient(region ? { region } : {});
  }
  return bedrockClient;
}

function getComprehendClient(): ComprehendClient {
  if (!comprehendClient) {
    comprehendClient = new ComprehendClient({});
  }
  return comprehendClient;
}

/**
 * Shape of the Anthropic Messages API response returned via Bedrock InvokeModel.
 */
interface BedrockClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Format a single segment as a context line: "[話者ラベル] テキスト".
 * When the segment has no speaker label, the bracket prefix is omitted.
 */
function formatSegmentLine(segment: SegmentSummary): string {
  const label = segment.speakerLabel?.trim();
  const text = segment.originalText.trim();
  return label ? `[${label}] ${text}` : text;
}

/**
 * Merge a session's master speaker-label list with the labels derived from its
 * segments, preserving first-appearance order and removing duplicates/empties.
 *
 * This mirrors the review UI, which shows the UNION of ReviewSession.speakerLabels
 * and each Segment.speakerLabel.
 *
 * @param masterLabels - ReviewSession.speakerLabels (may be undefined).
 * @param segments - Session segments whose speakerLabel values are also included.
 * @returns Distinct, non-empty labels in order of first appearance.
 */
export function unionSpeakerLabels(
  masterLabels: string[] | undefined,
  segments: SegmentSummary[]
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const add = (raw: string | undefined) => {
    const label = raw?.trim();
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  };

  for (const label of masterLabels ?? []) {
    add(label);
  }
  for (const segment of segments) {
    add(segment.speakerLabel);
  }

  return labels;
}

/**
 * Select the segments surrounding the target, centered on the target and
 * expanding alternately forward/backward, while keeping the total formatted
 * length within `maxChars`.
 *
 * The target segment is always included (even if it alone exceeds the budget).
 * Output order matches the input order (startTime ascending). When the target
 * id is not present in `segments`, an empty array is returned.
 *
 * Pure function — no I/O.
 *
 * @param segments - All session segments in startTime order.
 * @param targetSegmentId - The segment currently under review.
 * @param maxChars - Total formatted-length budget (default MAX_CONTEXT_LENGTH).
 * @returns The selected segments in startTime order.
 */
export function selectSurroundingSegments(
  segments: SegmentSummary[],
  targetSegmentId: string,
  maxChars: number = MAX_CONTEXT_LENGTH
): SegmentSummary[] {
  const targetIndex = segments.findIndex((s) => s.segmentId === targetSegmentId);
  if (targetIndex === -1) {
    return [];
  }

  // Formatted length of a segment as it will appear in the context block.
  const lineLength = (segment: SegmentSummary, isTarget: boolean): number =>
    formatSegmentLine(segment).length + (isTarget ? TARGET_SEGMENT_MARKER.length : 0);

  // Track the inclusive window [lo, hi]. The target is always included first.
  const selectedIndices = new Set<number>([targetIndex]);
  let total = lineLength(segments[targetIndex], true);

  let before = targetIndex - 1;
  let after = targetIndex + 1;
  // Expand alternately: after, before, after, before... to stay balanced.
  let takeAfter = true;

  while (before >= 0 || after < segments.length) {
    const canAfter = after < segments.length;
    const canBefore = before >= 0;
    // Decide which side to try this round, respecting availability.
    const side = takeAfter ? (canAfter ? 'after' : 'before') : canBefore ? 'before' : 'after';

    if (side === 'after' && canAfter) {
      const cost = lineLength(segments[after], false);
      if (total + cost > maxChars) break;
      selectedIndices.add(after);
      total += cost;
      after += 1;
    } else if (side === 'before' && canBefore) {
      const cost = lineLength(segments[before], false);
      if (total + cost > maxChars) break;
      selectedIndices.add(before);
      total += cost;
      before -= 1;
    } else {
      break;
    }

    takeAfter = !takeAfter;
  }

  return segments.filter((_, index) => selectedIndices.has(index));
}

/**
 * Build the Japanese context string injected into the Bedrock prompt from the
 * session's speaker list and the selected surrounding segments.
 *
 * Layout:
 *   このセッションの話者: 話者A, 話者B
 *
 *   前後の文脈:
 *   [話者A] ...
 *   [話者B] ...   ← 修正対象のセグメント
 *
 * The speaker line is omitted when there are no labels. The target segment line
 * is marked so Claude can identify the segment under review. Returns an empty
 * string when there is nothing to show.
 *
 * Pure function — no I/O.
 */
export function buildSegmentContext(params: {
  speakerLabels: string[];
  surroundingSegments: SegmentSummary[];
  targetSegmentId: string;
}): string {
  const { speakerLabels, surroundingSegments, targetSegmentId } = params;

  const sections: string[] = [];

  if (speakerLabels.length > 0) {
    sections.push(`このセッションの話者: ${speakerLabels.join(', ')}`);
  }

  const lines = surroundingSegments
    .map((segment) => {
      const line = formatSegmentLine(segment);
      if (line.trim() === '') return '';
      return segment.segmentId === targetSegmentId ? `${line}${TARGET_SEGMENT_MARKER}` : line;
    })
    .filter((line) => line !== '');

  if (lines.length > 0) {
    sections.push(['前後の文脈:', ...lines].join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Fetch and assemble the surrounding-segment + speaker-list context for a
 * segment under review.
 *
 * Flow:
 * 1. Fetch the session (for the master speaker list) and all session segments
 *    in parallel.
 * 2. Union the master speaker labels with the segment-derived labels.
 * 3. Select surrounding segments within the character budget.
 * 4. Format the Japanese context string.
 *
 * On any failure, logs to CloudWatch and returns an empty string so suggestion
 * generation falls back to the original text alone (no throw).
 *
 * @param sessionId - The session the segment belongs to.
 * @param segmentId - The segment under review.
 * @returns The context string, or an empty string on failure / no context.
 */
export async function getSuggestionContext(
  sessionId: string,
  segmentId: string
): Promise<string> {
  try {
    const [session, segments] = await Promise.all([
      getSessionById(sessionId),
      getSessionSegments(sessionId),
    ]);

    const speakerLabels = unionSpeakerLabels(session?.speakerLabels, segments);
    const surroundingSegments = selectSurroundingSegments(segments, segmentId);

    return buildSegmentContext({ speakerLabels, surroundingSegments, targetSegmentId: segmentId });
  } catch (error: unknown) {
    // Context is best-effort: log the real failure for diagnosability (same
    // policy as the Bedrock/Comprehend failure logs) and fall back to no
    // context so suggestion generation still succeeds on the original text.
    console.error(
      `getSuggestionContext failed for session ${sessionId} segment ${segmentId}:`,
      error
    );
    return '';
  }
}

/**
 * Build the Anthropic Messages API prompt for correction suggestions.
 * Instructs Claude to return one candidate per line with no extra commentary
 * so the response can be parsed deterministically.
 */
function buildBedrockPrompt(originalText: string, context?: string): string {
  const contextLine = context ? `\n周辺の文脈: ${context}` : '';
  return (
    '以下は音声の文字起こし結果の1セグメントです。' +
    `誤変換や誤字脱字を修正した候補を最大${BEDROCK_MAX_CANDIDATES}件提案してください。` +
    '各候補は修正後のテキストのみを1行ずつ出力し、番号・記号・説明は付けないでください。' +
    `\n\n文字起こしテキスト: ${originalText}${contextLine}`
  );
}

/**
 * Parse Claude's line-delimited output into suggestion candidates.
 */
function parseBedrockCandidates(responseText: string): SuggestionCandidate[] {
  return responseText
    .split('\n')
    .map((line) => line.trim())
    // Strip common list markers (e.g. "1.", "- ", "・") the model may still add.
    .map((line) => line.replace(/^[\d]+[.)．、]\s*/, '').replace(/^[-*・]\s*/, '').trim())
    .filter((line) => line !== '')
    .slice(0, BEDROCK_MAX_CANDIDATES)
    .map((text) => ({ text, source: 'bedrock' as const }));
}

/**
 * Default Bedrock suggestion provider.
 * Calls Amazon Bedrock (Claude) via the InvokeModel API to generate text
 * correction suggestions for a transcription segment.
 */
export const defaultBedrockProvider: BedrockSuggestionProvider = {
  async getSuggestions(originalText: string, context?: string): Promise<SuggestionCandidate[]> {
    const trimmed = originalText.trim();
    if (trimmed === '') {
      return [];
    }

    const requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 512,
      // Deterministic/efficient output via the control the model supports:
      // `temperature: 0` for Haiku 4.5, `output_config.effort: 'low'` for
      // Haiku 5.5 (which removed temperature). The two are mutually exclusive.
      ...inferenceControlParams(BEDROCK_MODEL_ID),
      messages: [
        {
          role: 'user',
          content: buildBedrockPrompt(trimmed, context),
        },
      ],
    };

    const response = await getBedrockClient().send(
      new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      })
    );

    const decoded = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(decoded) as BedrockClaudeResponse;

    const text = (parsed.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('\n');

    return parseBedrockCandidates(text);
  },
};

/**
 * Default Comprehend suggestion provider.
 * Uses Amazon Comprehend DetectKeyPhrases and DetectEntities to surface
 * key phrases and named entities from the segment. These act as
 * lower-priority correction candidates (e.g. proper nouns worth confirming).
 */
export const defaultComprehendProvider: ComprehendSuggestionProvider = {
  async getSuggestions(originalText: string): Promise<SuggestionCandidate[]> {
    const trimmed = originalText.trim();
    if (trimmed === '') {
      return [];
    }

    const client = getComprehendClient();

    const [keyPhraseResult, entityResult] = await Promise.all([
      client.send(
        new DetectKeyPhrasesCommand({
          Text: trimmed,
          LanguageCode: COMPREHEND_LANGUAGE_CODE,
        })
      ),
      client.send(
        new DetectEntitiesCommand({
          Text: trimmed,
          LanguageCode: COMPREHEND_LANGUAGE_CODE,
        })
      ),
    ]);

    const seen = new Set<string>();
    const candidates: SuggestionCandidate[] = [];

    const addText = (raw: string | undefined) => {
      const text = (raw ?? '').trim();
      if (text !== '' && !seen.has(text)) {
        seen.add(text);
        candidates.push({ text, source: 'comprehend' });
      }
    };

    for (const phrase of keyPhraseResult.KeyPhrases ?? []) {
      addText(phrase.Text);
    }
    for (const entity of entityResult.Entities ?? []) {
      addText(entity.Text);
    }

    return candidates;
  },
};

/**
 * Generate suggestions for a segment by combining multiple sources.
 *
 * Flow:
 * 1. Query CorrectionHistory and assemble the surrounding-segment context in parallel
 * 2. Call Bedrock (with context) and Comprehend in parallel
 * 3. Merge results with priority: history → bedrock → comprehend
 * 4. Deduplicate and limit to max 5 candidates
 * 5. On external API failure, return history candidates + error flag
 *
 * @param sessionId - The session the segment belongs to (used to build context)
 * @param segmentId - The segment to generate suggestions for
 * @param originalText - The original text of the segment
 * @param bedrockProvider - Bedrock suggestion provider (injectable for testing)
 * @param comprehendProvider - Comprehend suggestion provider (injectable for testing)
 */
export async function generateSuggestions(
  sessionId: string,
  segmentId: string,
  originalText: string,
  bedrockProvider: BedrockSuggestionProvider = defaultBedrockProvider,
  comprehendProvider: ComprehendSuggestionProvider = defaultComprehendProvider
): Promise<SuggestionResult> {
  // Step 1: Get history candidates and the surrounding-segment context in
  // parallel. Both must resolve before we can call Bedrock, since Bedrock's
  // prompt includes the context. getSuggestionContext never throws (it falls
  // back to an empty string), so it does not affect hasExternalApiError.
  const [historyCandidates, context] = await Promise.all([
    getCorrectionHistoryCandidates(segmentId),
    getSuggestionContext(sessionId, segmentId),
  ]);

  // Step 2: Call Bedrock (with context) and Comprehend in parallel
  let bedrockCandidates: SuggestionCandidate[] = [];
  let comprehendCandidates: SuggestionCandidate[] = [];
  let hasExternalApiError = false;

  const [bedrockResult, comprehendResult] = await Promise.allSettled([
    bedrockProvider.getSuggestions(originalText, context || undefined),
    comprehendProvider.getSuggestions(originalText),
  ]);

  if (bedrockResult.status === 'fulfilled') {
    bedrockCandidates = bedrockResult.value;
  } else {
    hasExternalApiError = true;
    // Log the real failure (e.g. Bedrock AccessDenied / model not enabled /
    // ValidationException) to CloudWatch. The caller only sees the
    // hasExternalApiError flag, so without this the root cause is invisible.
    console.error(
      `Bedrock getSuggestions failed for segment ${segmentId} (model ${BEDROCK_MODEL_ID}):`,
      bedrockResult.reason
    );
  }

  if (comprehendResult.status === 'fulfilled') {
    comprehendCandidates = comprehendResult.value;
  } else {
    hasExternalApiError = true;
    // Log the real Comprehend failure (e.g. unsupported language, throttling)
    // to CloudWatch for the same diagnosability reason as above.
    console.error(
      `Comprehend getSuggestions failed for segment ${segmentId}:`,
      comprehendResult.reason
    );
  }

  // Step 3: Merge with priority ordering and deduplicate
  const merged = mergeSuggestions(historyCandidates, bedrockCandidates, comprehendCandidates);

  // Step 4: Limit to max candidates
  const suggestions = limitSuggestions(merged);

  return { suggestions, hasExternalApiError };
}
