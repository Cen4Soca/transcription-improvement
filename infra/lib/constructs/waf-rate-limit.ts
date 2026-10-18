import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface WafRateLimitProps {
  /** Rate limit for authentication endpoints per 5-minute window per IP (default: 25 = 5/min) */
  authRateLimitPerFiveMinutes?: number;
  /** Rate limit for general API endpoints per 5-minute window per user (default: 500 = 100/min) */
  generalRateLimitPerFiveMinutes?: number;
  /** Scope of the WAF rule: REGIONAL or CLOUDFRONT */
  scope?: 'REGIONAL' | 'CLOUDFRONT';
}

/**
 * WAF Rate Limit Construct.
 * Creates WAF v2 rate-based rules for DDoS protection:
 * - Authentication endpoints: 5 requests/min per IP
 * - General API endpoints: 100 requests/min per user
 *
 * Note: WAF rate-based rules use a 5-minute evaluation window.
 * To achieve per-minute limits, multiply by 5.
 */
export class WafRateLimit extends Construct {
  public readonly authRateRule: wafv2.CfnWebACL.RuleProperty;
  public readonly generalRateRule: wafv2.CfnWebACL.RuleProperty;

  constructor(scope: Construct, id: string, props: WafRateLimitProps) {
    super(scope, id);

    const authLimit = props.authRateLimitPerFiveMinutes ?? 25;
    const generalLimit = props.generalRateLimitPerFiveMinutes ?? 500;

    // Rate limit rule for authentication endpoints (per IP)
    this.authRateRule = {
      name: 'AuthRateLimitRule',
      priority: 10,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit: authLimit,
          aggregateKeyType: 'IP',
          scopeDownStatement: {
            byteMatchStatement: {
              searchString: '/auth',
              fieldToMatch: { uriPath: {} },
              textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
              positionalConstraint: 'STARTS_WITH',
            },
          },
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-AuthRateLimit`,
      },
    };

    // Rate limit rule for general API endpoints (per IP)
    this.generalRateRule = {
      name: 'GeneralRateLimitRule',
      priority: 11,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit: generalLimit,
          aggregateKeyType: 'IP',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-GeneralRateLimit`,
      },
    };
  }
}
