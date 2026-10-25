import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface CloudFrontWafStackProps extends cdk.StackProps {
  /** List of allowed IP CIDR blocks */
  allowedIpCidrs: string[];
  /** Rate limit for authentication endpoints per 5-minute window per IP */
  authRateLimitPerFiveMinutes?: number;
  /** Rate limit for general endpoints per 5-minute window per IP */
  generalRateLimitPerFiveMinutes?: number;
  /**
   * Action for AWS Managed Rule groups.
   * 'count' (default) observes matches without blocking — recommended for
   * initial rollout. Switch to 'block' once sampled requests confirm no
   * false positives against legitimate traffic.
   */
  managedRuleAction?: 'count' | 'block';
}

/**
 * CloudFront WAF Stack - deployed to us-east-1.
 *
 * CloudFront requires WAF WebACLs to be in us-east-1 with CLOUDFRONT scope.
 * This stack creates the WebACL and stores its ARN in SSM Parameter Store
 * for cross-region reference.
 */
export class CloudFrontWafStack extends cdk.Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: CloudFrontWafStackProps) {
    super(scope, id, props);

    const authLimit = props.authRateLimitPerFiveMinutes ?? 25;
    const generalLimit = props.generalRateLimitPerFiveMinutes ?? 500;
    const hasIpRestriction = props.allowedIpCidrs.length > 0;
    // Managed rules default to COUNT so a rollout can observe matches before blocking.
    const managedOverride = (props.managedRuleAction ?? 'count') === 'block'
      ? { none: {} }
      : { count: {} };

    // WAF v2 IP Set (CLOUDFRONT scope, us-east-1)
    const ipSet = new wafv2.CfnIPSet(this, 'CloudFrontIpSet', {
      name: `${id}-IPAllowlist`,
      scope: 'CLOUDFRONT',
      ipAddressVersion: 'IPV4',
      addresses: props.allowedIpCidrs,
      description: 'IP Allowlist for CloudFront distributions - max 1,000 entries',
    });

    // Build WAF rules
    const rules: wafv2.CfnWebACL.RuleProperty[] = [];

    // Rule 1: Auth endpoint rate limiting (per IP)
    rules.push({
      name: 'AuthRateLimitRule',
      priority: 1,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit: authLimit,
          aggregateKeyType: 'IP',
          scopeDownStatement: {
            byteMatchStatement: {
              searchString: '/api/auth',
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
    });

    // Rule 2: General rate limiting (per IP)
    rules.push({
      name: 'GeneralRateLimitRule',
      priority: 2,
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
    });

    // Rules 3-5: AWS Managed Rule groups.
    // Placed BEFORE the IP allowlist allow-rule on purpose: when IP restriction
    // is active the WebACL default action is BLOCK and the allowlist rule is a
    // terminating ALLOW, so any rule after it is never evaluated. Evaluating the
    // managed rules first lets them inspect traffic even from allowlisted IPs.
    // overrideAction uses COUNT by default (see managedRuleAction prop).
    rules.push({
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 3,
      overrideAction: managedOverride,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-CommonRuleSet`,
      },
    });

    rules.push({
      name: 'AWSManagedRulesKnownBadInputsRuleSet',
      priority: 4,
      overrideAction: managedOverride,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-KnownBadInputs`,
      },
    });

    rules.push({
      name: 'AWSManagedRulesAmazonIpReputationList',
      priority: 5,
      overrideAction: managedOverride,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesAmazonIpReputationList',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-AmazonIpReputation`,
      },
    });

    // Rule 10: IP Allowlist (only when entries exist)
    if (hasIpRestriction) {
      rules.push({
        name: 'IPAllowlistRule',
        priority: 10,
        action: { allow: {} },
        statement: {
          ipSetReferenceStatement: {
            arn: ipSet.attrArn,
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

    const webAcl = new wafv2.CfnWebACL(this, 'CloudFrontWebAcl', {
      name: `${id}-WebACL`,
      scope: 'CLOUDFRONT',
      defaultAction,
      rules,
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-WebACL`,
      },
      description: 'WAF WebACL for CloudFront - IP allowlist and rate limiting',
    });

    this.webAclArn = webAcl.attrArn;

    // Store WebACL ARN in SSM Parameter Store for cross-region reference
    new ssm.StringParameter(this, 'WebAclArnParam', {
      parameterName: `/transcription-review/${id}/web-acl-arn`,
      stringValue: webAcl.attrArn,
      description: 'CloudFront WAF WebACL ARN for cross-region reference',
    });

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'WebAclArn', {
      value: webAcl.attrArn,
      exportName: `${id}-WebAclArn`,
    });

    new cdk.CfnOutput(this, 'WebAclId', {
      value: webAcl.attrId,
      exportName: `${id}-WebAclId`,
    });
  }
}
