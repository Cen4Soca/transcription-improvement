import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import { resolveBedrockRegion } from '../utils/bedrock-region.js';

/**
 * Result of the session-name suggestion process.
 * `suggestion` is always 100 characters or fewer (null when unavailable).
 */
export interface SessionNameSuggestionResult {
  suggestion: string | null;
  hasExternalApiError: boolean;
}

/**
 * Interface for the session-name suggestion provider.
 * Mock-friendly for testing (injectable into suggestSessionName).
 */
export interface SessionNameProvider {
  suggestName(transcriptText: string): Promise<string>;
}

/** Maximum length (characters) of a suggested session name. */
const MAX_SESSION_NAME_LENGTH = 100;

/** Maximum length of transcript text fed to Bedrock to bound prompt size. */
const MAX_TRANSCRIPT_LENGTH = 2000;

// --- External API configuration ---

/**
 * Bedrock model ID used for session-name suggestion.
 *
 * Defaults to the JP cross-region inference profile for Claude Haiku 4.5,
 * matching suggestion-service.ts. In ap-northeast-1 Anthropic models only
 * support the INFERENCE_PROFILE inference type. Must match the model ID
 * granted in infra (`api-stack.ts` / `bedrock-comprehend.ts`).
 */
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';

// --- Lazily-initialized AWS SDK client (reused across warm invocations) ---

let bedrockClient: BedrockRuntimeClient | undefined;

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

/**
 * Shape of the Anthropic Messages API response returned via Bedrock InvokeModel.
 */
interface BedrockClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Build the Anthropic Messages API prompt for a session-name suggestion.
 */
function buildPrompt(transcriptText: string): string {
  return (
    '以下の文字起こし内容に対する簡潔な日本語のセッション名を1つだけ、' +
    '100文字以内で、記号や引用符を付けずに出力してください。' +
    `\n\n${transcriptText}`
  );
}

/**
 * Default session-name suggestion provider.
 * Calls Amazon Bedrock (Claude) via the InvokeModel API to generate a concise
 * Japanese session name from the transcription text.
 */
export const defaultSessionNameProvider: SessionNameProvider = {
  async suggestName(transcriptText: string): Promise<string> {
    const requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 128,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: buildPrompt(transcriptText),
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

    return (parsed.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('');
  },
};

/**
 * Fetch and concatenate the transcription segment text for a session.
 *
 * Uses the same DynamoDB access pattern as get-segments.ts
 * (PK = SESSION#{sessionId}, SK begins_with SEGMENT#) and concatenates each
 * segment's originalText in startTime order. The result is capped at
 * MAX_TRANSCRIPT_LENGTH characters to avoid oversized prompts.
 *
 * @param sessionId - The session whose transcript text to retrieve
 * @returns The concatenated transcript text (possibly empty)
 */
export async function getTranscriptTextForSession(sessionId: string): Promise<string> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'SEGMENT#',
      },
      ScanIndexForward: true,
    })
  );

  const text = (result.Items ?? [])
    .map((item) => (item['originalText'] as string | undefined) ?? '')
    .filter((segment) => segment.trim() !== '')
    .join(' ');

  return text.slice(0, MAX_TRANSCRIPT_LENGTH);
}

/**
 * Suggest a concise Japanese session name from a session's transcript text.
 *
 * Flow:
 * 1. Fetch transcript text for the session.
 * 2. If empty, return { suggestion: null, hasExternalApiError: false }.
 * 3. Call the provider; trim and cap the result to 100 characters.
 * 4. On provider failure, swallow the error and return
 *    { suggestion: null, hasExternalApiError: true }.
 *
 * The returned suggestion is always 100 characters or fewer (null when empty).
 *
 * @param sessionId - The session to suggest a name for
 * @param provider - Suggestion provider (injectable for testing)
 */
export async function suggestSessionName(
  sessionId: string,
  provider: SessionNameProvider = defaultSessionNameProvider
): Promise<SessionNameSuggestionResult> {
  const transcriptText = await getTranscriptTextForSession(sessionId);

  if (transcriptText.trim() === '') {
    return { suggestion: null, hasExternalApiError: false };
  }

  try {
    const raw = await provider.suggestName(transcriptText);
    const trimmed = raw.trim().slice(0, MAX_SESSION_NAME_LENGTH);
    return {
      suggestion: trimmed === '' ? null : trimmed,
      hasExternalApiError: false,
    };
  } catch (error: unknown) {
    // Log the real failure (e.g. Bedrock AccessDenied / model not enabled /
    // ValidationException) to CloudWatch. The caller only sees the
    // hasExternalApiError flag, so without this the root cause is invisible.
    console.error(
      `Bedrock suggestName failed for session ${sessionId} (model ${BEDROCK_MODEL_ID}):`,
      error
    );
    return { suggestion: null, hasExternalApiError: true };
  }
}
