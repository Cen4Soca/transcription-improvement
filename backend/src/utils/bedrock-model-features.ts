/**
 * Per-model feature detection for Bedrock (Anthropic Claude) invocations.
 *
 * Different Claude models accept different inference parameters, and the
 * sampling / effort controls are mutually exclusive across model generations:
 *
 *   - Claude Haiku 4.5 (and earlier) accept the `temperature` sampling
 *     parameter and rely on it for deterministic (`temperature: 0`) output.
 *     They REJECT `output_config.effort` with a `ValidationException`
 *     ("This model does not support the effort parameter.").
 *   - Claude 5.x models (e.g. Haiku 5.5) REMOVED `temperature` (sending it
 *     yields "`temperature` is deprecated for this model.") and instead expose
 *     effort controls via a top-level `output_config.effort` field.
 *
 * This module centralizes that knowledge so callers (suggestion-service,
 * session-name-suggestion-service) can build a request body that is valid for
 * whichever model `BEDROCK_MODEL_ID` points at, without duplicating the rule.
 *
 * Verified against Bedrock (ap-northeast-1) with both Haiku 4.5 and Haiku 5.5.
 *
 * ---------------------------------------------------------------------------
 * PLANNED REMOVAL — when Claude Haiku 4.5 (and any other temperature-based
 * model) reaches EOL and is no longer a deployable `BEDROCK_MODEL_ID`, the
 * `temperature` branch becomes dead logic. At that point this whole module can
 * be deleted and callers can inline a fixed `output_config: { effort: 'low' }`
 * on the request body. Concretely, delete:
 *   - `supportsTemperature` (no longer any temperature-based model to detect)
 *   - the `temperature` option and the `{ temperature }` return branch of
 *     `inferenceControlParams` (effort becomes unconditional)
 *   - the `EFFORT_BASED_MODELS` list (every supported model uses effort)
 * Search callers for `inferenceControlParams(` to update them.
 * ---------------------------------------------------------------------------
 */

/**
 * Effort levels accepted by the `output_config.effort` field on Claude models
 * that support effort controls. See:
 * https://platform.claude.com/docs/en/build-with-claude/effort
 *
 * `low` is the most efficient (fastest, cheapest, best for short/templated
 * tasks) and is the closest replacement for the deterministic `temperature: 0`
 * behavior older models used.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Model-ID substrings whose foundation model has removed the `temperature`
 * inference parameter and instead supports effort controls. Matched against
 * the model ID after any geographic inference-profile prefix (`jp.`, `eu.`,
 * `global.`, ...) — the substring test works regardless of prefix, so
 * `jp.anthropic.claude-haiku-5-5`, `eu.anthropic.claude-haiku-5-5`, and the
 * bare `anthropic.claude-haiku-5-5` are all detected.
 *
 * Claude 5.x models (Haiku 5.5, and the Sonnet/Opus members of the 5.x family)
 * dropped `temperature` in favor of effort controls. Extend this list as new
 * effort-based models are adopted.
 */
const EFFORT_BASED_MODELS = [
  'claude-haiku-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
] as const;

/**
 * Whether the given Bedrock model ID uses effort controls
 * (`output_config.effort`) instead of the `temperature` sampling parameter.
 *
 * @param modelId - Bedrock model ID or cross-Region inference profile ID.
 */
export function usesEffortControls(modelId: string): boolean {
  return EFFORT_BASED_MODELS.some((m) => modelId.includes(m));
}

/**
 * Whether the given Bedrock model ID accepts the `temperature` inference
 * parameter.
 *
 * Returns `false` for effort-based Claude 5.x models (which rejected
 * `temperature`), and `true` for every other model (the safe default — older
 * Claude models accept and benefit from `temperature: 0` for deterministic
 * output).
 *
 * @param modelId - Bedrock model ID or cross-Region inference profile ID.
 *
 * DEAD-LOGIC-ON-HAIKU-4.5-EOL: delete once no temperature-based model is
 * deployable (see module header).
 */
export function supportsTemperature(modelId: string): boolean {
  return !usesEffortControls(modelId);
}

/**
 * Build the inference-control fragment to spread into an Anthropic Messages API
 * request body, honoring whichever control the target model supports.
 *
 * - For `temperature`-based models (e.g. Haiku 4.5): returns
 *   `{ temperature }`.
 * - For effort-based models (e.g. Haiku 5.5): returns
 *   `{ output_config: { effort } }`.
 *
 * The two are mutually exclusive — a model rejects the control it does not
 * support — so exactly one (or neither) is emitted per request.
 *
 * Usage:
 *   const requestBody = {
 *     anthropic_version: 'bedrock-2023-05-31',
 *     max_tokens: 512,
 *     ...inferenceControlParams(BEDROCK_MODEL_ID),
 *     messages: [...],
 *   };
 *
 * @param modelId - Bedrock model ID or cross-Region inference profile ID.
 * @param options - Override the deterministic defaults if needed.
 * @param options.temperature - Temperature to send to temperature-based models
 *   (default `0` for deterministic output).
 * @param options.effort - Effort level to send to effort-based models
 *   (default `'low'`, the cheapest/fastest, closest to `temperature: 0`).
 * @returns An object to spread into the request body.
 */
export function inferenceControlParams(
  modelId: string,
  options: { temperature?: number; effort?: EffortLevel } = {}
):
  | { temperature: number }
  | { output_config: { effort: EffortLevel } } {
  const { temperature = 0, effort = 'low' } = options;
  return usesEffortControls(modelId)
    ? { output_config: { effort } }
    : // DEAD-LOGIC-ON-HAIKU-4.5-EOL: this branch (and the `temperature` option)
      // goes away once every deployable model uses effort controls; effort
      // then becomes unconditional (see module header).
      { temperature };
}
