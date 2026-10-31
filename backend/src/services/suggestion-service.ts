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
 * 1. Query CorrectionHistory from DynamoDB
 * 2. Call Bedrock and Comprehend in parallel
 * 3. Merge results with priority: history → bedrock → comprehend
 * 4. Deduplicate and limit to max 5 candidates
 * 5. On external API failure, return history candidates + error flag
 *
 * @param segmentId - The segment to generate suggestions for
 * @param originalText - The original text of the segment
 * @param bedrockProvider - Bedrock suggestion provider (injectable for testing)
 * @param comprehendProvider - Comprehend suggestion provider (injectable for testing)
 */
export async function generateSuggestions(
  segmentId: string,
  originalText: string,
  bedrockProvider: BedrockSuggestionProvider = defaultBedrockProvider,
  comprehendProvider: ComprehendSuggestionProvider = defaultComprehendProvider
): Promise<SuggestionResult> {
  // Step 1: Get history candidates
  const historyCandidates = await getCorrectionHistoryCandidates(segmentId);

  // Step 2: Call Bedrock and Comprehend in parallel
  let bedrockCandidates: SuggestionCandidate[] = [];
  let comprehendCandidates: SuggestionCandidate[] = [];
  let hasExternalApiError = false;

  const [bedrockResult, comprehendResult] = await Promise.allSettled([
    bedrockProvider.getSuggestions(originalText),
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
