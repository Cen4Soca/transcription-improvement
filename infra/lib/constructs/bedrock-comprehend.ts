import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface BedrockComprehendProps {
  /**
   * Bedrock model ID to grant access to.
   *
   * May be either a bare foundation-model ID (e.g.
   * `anthropic.claude-haiku-4-5-20251001-v1:0`) or a supported geographic
   * cross-Region inference profile ID. Only the JP and EU geographies are
   * supported:
   *   - `jp.` (e.g. `jp.anthropic.claude-haiku-4-5-20251001-v1:0`)
   *   - `eu.` (e.g. `eu.anthropic.claude-sonnet-5-5`)
   *
   * When a supported inference profile ID is supplied, the construct grants
   * access to both the inference-profile ARN (scoped to that geography's
   * source region) and the underlying foundation-model ARN across every
   * destination region the profile can route to.
   *
   * Unsupported inference-profile prefixes (`us.`, `apac.`, `global.`) are
   * rejected at synth time to prevent configurations that violate the JP/EU
   * data-residency policy.
   */
  bedrockModelId: string;
  /** AWS region for Comprehend and bare-model-ID ARNs (default: ap-northeast-1) */
  region?: string;
  /** AWS account ID for constructing ARNs */
  accountId: string;
}

/**
 * A supported geographic cross-Region inference profile.
 */
interface GeoProfile {
  /** Source region the inference-profile ARN is scoped to. */
  sourceRegion: string;
  /**
   * Destination regions the profile may route requests to. IAM requires the
   * underlying foundation-model ARN to be authorized in every region the
   * profile can dispatch to, otherwise InvokeModel fails with
   * AccessDeniedException.
   */
  destinationRegions: string[];
}

/**
 * Supported geographic inference profiles keyed by their model-ID prefix.
 * Only JP and EU are supported (APAC is intentionally excluded). See:
 * https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
 */
const GEO_BY_PREFIX: Record<string, GeoProfile> = {
  'jp.': {
    sourceRegion: 'ap-northeast-1',
    destinationRegions: ['ap-northeast-1', 'ap-northeast-3'],
  },
  'eu.': {
    sourceRegion: 'eu-central-1',
    destinationRegions: [
      'eu-central-1',
      'eu-west-1',
      'eu-west-3',
      'eu-north-1',
      'eu-south-1',
      'eu-south-2',
    ],
  },
};

/**
 * Inference-profile prefixes that denote a cross-Region inference profile but
 * are NOT supported by this application's JP/EU-only data-residency policy.
 */
const UNSUPPORTED_PROFILE_PREFIXES = ['us.', 'apac.', 'global.'] as const;

/**
 * Resolve the supported geographic profile for a model ID, or `undefined` when
 * the ID is a bare foundation-model ID (no recognized prefix).
 *
 * Throws when the ID uses an inference-profile prefix that is not supported
 * (`us.`, `apac.`, `global.`), so misconfigurations fail fast at synth time.
 */
function resolveGeoProfile(modelId: string): GeoProfile | undefined {
  for (const [prefix, geo] of Object.entries(GEO_BY_PREFIX)) {
    if (modelId.startsWith(prefix)) {
      return geo;
    }
  }
  for (const prefix of UNSUPPORTED_PROFILE_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      throw new Error(
        `Unsupported Bedrock inference profile prefix in "${modelId}". ` +
          `Only JP (jp.) and EU (eu.) geographic profiles are supported.`
      );
    }
  }
  // No recognized prefix: treat as a bare foundation-model ID.
  return undefined;
}

/**
 * Strip a known geographic inference-profile prefix to recover the underlying
 * foundation-model ID.
 */
function toFoundationModelId(modelId: string): string {
  for (const prefix of Object.keys(GEO_BY_PREFIX)) {
    if (modelId.startsWith(prefix)) {
      return modelId.slice(prefix.length);
    }
  }
  return modelId;
}

/**
 * Bedrock + Comprehend permissions Construct.
 * Grants Lambda functions the necessary IAM permissions to invoke
 * Amazon Bedrock and Amazon Comprehend APIs.
 *
 * Bedrock invocation supports JP and EU geographic cross-Region inference
 * profiles (and bare foundation-model IDs). The source region targeted by the
 * caller is determined by the geography of the inference profile, matching the
 * backend's `resolveBedrockRegion` helper.
 */
export class BedrockComprehend extends Construct {
  public readonly bedrockPolicy: iam.PolicyStatement;
  public readonly comprehendPolicy: iam.PolicyStatement;

  constructor(scope: Construct, id: string, props: BedrockComprehendProps) {
    super(scope, id);

    const region = props.region ?? 'ap-northeast-1';
    const { accountId, bedrockModelId } = props;

    // Bedrock InvokeModel permission.
    //
    // When bedrockModelId is a supported geographic inference profile (e.g.
    // `eu.anthropic.claude-sonnet-5-5`), the caller invokes the
    // inference-profile ARN (scoped to the geography's source region), and
    // Bedrock in turn invokes the underlying foundation model in one of that
    // geography's destination regions. IAM therefore requires BOTH the
    // inference-profile ARN AND the foundation-model ARN in every destination
    // region to be authorized. For a bare foundation-model ID we grant only
    // the single in-region foundation-model ARN.
    const bedrockResources: string[] = [];
    const geo = resolveGeoProfile(bedrockModelId);

    if (geo) {
      const foundationModelId = toFoundationModelId(bedrockModelId);
      // The inference profile itself (geography source region + account scoped).
      bedrockResources.push(
        `arn:aws:bedrock:${geo.sourceRegion}:${accountId}:inference-profile/${bedrockModelId}`
      );
      // The underlying foundation model across all destination regions.
      for (const destRegion of geo.destinationRegions) {
        bedrockResources.push(
          `arn:aws:bedrock:${destRegion}::foundation-model/${foundationModelId}`
        );
      }
    } else {
      bedrockResources.push(
        `arn:aws:bedrock:${region}::foundation-model/${bedrockModelId}`
      );
    }

    this.bedrockPolicy = new iam.PolicyStatement({
      sid: 'AllowBedrockInvokeModel',
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: bedrockResources,
    });

    // Comprehend DetectEntities and DetectKeyPhrases permission - restricted to region
    this.comprehendPolicy = new iam.PolicyStatement({
      sid: 'AllowComprehendDetect',
      effect: iam.Effect.ALLOW,
      actions: [
        'comprehend:DetectEntities',
        'comprehend:DetectKeyPhrases',
        'comprehend:DetectDominantLanguage',
      ],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'aws:RequestedRegion': region,
        },
      },
    });
  }

  /**
   * Grant Bedrock and Comprehend permissions to an IAM role
   */
  public grantInvoke(role: iam.IRole): void {
    role.addToPrincipalPolicy(this.bedrockPolicy);
    role.addToPrincipalPolicy(this.comprehendPolicy);
  }
}
