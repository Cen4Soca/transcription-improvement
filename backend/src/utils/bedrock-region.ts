/**
 * Resolve the AWS region whose Bedrock endpoint should be invoked for a given
 * model / inference-profile ID.
 *
 * Geographic cross-Region inference requires the API call (the "source
 * region") to originate inside the geography the inference profile belongs to.
 * A `jp.` profile can only be invoked from a Japan source region, and an `eu.`
 * profile only from an EU source region. This maps the inference-profile
 * prefix to its source region:
 *
 *   - `jp.` -> ap-northeast-1 (Tokyo)
 *   - `eu.` -> eu-central-1  (Frankfurt)
 *
 * Any other ID — a bare foundation-model ID, or a prefix we do not support
 * (`us.`, `apac.`, `global.`) — returns `undefined`, letting the SDK fall back
 * to the Lambda execution region (ap-northeast-1). This keeps the helper's
 * responsibility limited to deciding the source region; it does not validate
 * or reject model IDs.
 *
 * @param modelId - Bedrock model ID or cross-Region inference profile ID.
 * @returns The source region to target, or `undefined` to use the SDK default.
 */
export function resolveBedrockRegion(modelId: string): string | undefined {
  if (modelId.startsWith('jp.')) return 'ap-northeast-1';
  if (modelId.startsWith('eu.')) return 'eu-central-1';
  return undefined;
}
