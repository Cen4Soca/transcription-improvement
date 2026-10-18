import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface WafIpAllowlistProps {
  /** List of allowed CIDR blocks (max 1,000 entries) */
  allowedIpCidrs: string[];
  /** Rate limit per 5-minute window per IP (default: 2000) */
  rateLimitPerFiveMinutes?: number;
  /** Scope of the WebACL: REGIONAL or CLOUDFRONT */
  scope?: 'REGIONAL' | 'CLOUDFRONT';
}

/**
 * WAF IP set management Construct.
 * Creates a WAF v2 WebACL with IP allowlist and rate limiting rules.
 *
 * Behavior:
 * - When allowedIpCidrs has 0 entries: no IP restriction applied (allow all traffic)
 * - When allowedIpCidrs has 1+ entries: only listed IPs are allowed
 * - Rate limiting is always applied for DDoS protection
 */
export class WafIpAllowlist extends Construct {
  public readonly webAcl: wafv2.CfnWebACL;
  public readonly ipSet: wafv2.CfnIPSet;

  constructor(scope: Construct, id: string, props: WafIpAllowlistProps) {
    super(scope, id);

    const wafScope = props.scope ?? 'REGIONAL';
    const rateLimit = props.rateLimitPerFiveMinutes ?? 2000;
    const hasIpRestriction = props.allowedIpCidrs.length > 0;

    // WAF v2 IP Set
    this.ipSet = new wafv2.CfnIPSet(this, 'IpSet', {
      name: `${id}-IPAllowlist`,
      scope: wafScope,
      ipAddressVersion: 'IPV4',
      addresses: props.allowedIpCidrs,
      description: 'IP Allowlist for Transcription Review App - max 1,000 entries',
    });

    // Build WAF rules
    const rules: wafv2.CfnWebACL.RuleProperty[] = [];

    // Rule 1: Rate limiting for DDoS protection (always active)
    rules.push({
      name: 'RateLimitRule',
      priority: 1,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit: rateLimit,
          aggregateKeyType: 'IP',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-RateLimit`,
      },
    });

    // Rule 2: IP Allowlist (only when entries exist)
    if (hasIpRestriction) {
      rules.push({
        name: 'IPAllowlistRule',
        priority: 2,
        action: { allow: {} },
        statement: {
          ipSetReferenceStatement: {
            arn: this.ipSet.attrArn,
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: `${id}-IPAllowlist`,
        },
      });
    }

    // WebACL default action:
    // - If IP restriction is active: BLOCK by default (only allowlisted IPs pass)
    // - If no IP restriction: ALLOW by default (all traffic passes, only rate limit applies)
    const defaultAction = hasIpRestriction ? { block: {} } : { allow: {} };

    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${id}-WebACL`,
      scope: wafScope,
      defaultAction,
      rules,
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-WebACL`,
      },
      description: 'WAF WebACL for Transcription Review App with IP allowlist and rate limiting',
    });
  }
}
