import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { describe, it, beforeAll, expect } from 'vitest';
import { CdnStack } from '../lib/stacks/cdn-stack';
import { WafRateLimit } from '../lib/constructs/waf-rate-limit';

/**
 * **Validates: Requirements 22.2, 22.3**
 */

describe('CdnStack - Snapshot', () => {
  it('matches the snapshot for new distribution mode', () => {
    const app = new cdk.App();
    const stack = new CdnStack(app, 'TestCdnStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      staticBucketName: 'transcription-review-data-123456789012',
      staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
      mediaBucketName: 'transcription-review-media-123456789012',
      mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
      allowedIpCidrs: ['203.0.113.0/24'],
      wafRegionalIpRateLimitPerFiveMinutes: 2000,
    });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });

  it('matches the snapshot for import distribution mode with basePath', () => {
    const app = new cdk.App();
    const stack = new CdnStack(app, 'TestCdnStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      staticBucketName: 'transcription-review-data-123456789012',
      staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
      mediaBucketName: 'transcription-review-media-123456789012',
      mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
      allowedIpCidrs: [],
      cloudFrontDistributionId: 'E1234567890ABC',
      basePath: 'review-app',
    });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});

describe('CdnStack', () => {
  describe('new distribution (no cloudFrontDistributionId)', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new CdnStack(app, 'TestCdnStack', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        staticBucketName: 'transcription-review-data-123456789012',
        staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
        mediaBucketName: 'transcription-review-media-123456789012',
        mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
        allowedIpCidrs: ['203.0.113.0/24', '198.51.100.0/24'],
        wafRegionalIpRateLimitPerFiveMinutes: 2000,
      });
      template = Template.fromStack(stack);
    });

    describe('CloudFront Distribution', () => {
      it('creates a single unified distribution', () => {
        template.resourceCountIs('AWS::CloudFront::Distribution', 1);
      });

      it('creates a distribution with SPA + Media + API comment', () => {
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: Match.objectLike({
            Comment: Match.stringLikeRegexp('SPA.*Media.*API'),
            DefaultRootObject: 'index.html',
          }),
        });
      });

      it('includes /media/* cache behavior for media files', () => {
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: Match.objectLike({
            CacheBehaviors: Match.arrayWith([
              Match.objectLike({
                PathPattern: '/media/*',
                ViewerProtocolPolicy: 'redirect-to-https',
              }),
            ]),
          }),
        });
      });

      it('enforces HTTPS on default behavior', () => {
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: Match.objectLike({
            DefaultCacheBehavior: Match.objectLike({
              ViewerProtocolPolicy: 'redirect-to-https',
            }),
          }),
        });
      });

      it('SPA fallback returns /index.html for 404 errors (no basePath)', () => {
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: Match.objectLike({
            CustomErrorResponses: Match.arrayWith([
              Match.objectLike({
                ErrorCode: 404,
                ResponseCode: 200,
                ResponsePagePath: '/index.html',
              }),
            ]),
          }),
        });
      });

      it('creates OAC for both static and media buckets', () => {
        template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2);
      });
    });

    describe('S3 Bucket Policies', () => {
      it('creates bucket policy for static bucket', () => {
        template.hasResourceProperties('AWS::S3::BucketPolicy', {
          Bucket: 'transcription-review-data-123456789012',
        });
      });

      it('creates bucket policy for media bucket', () => {
        template.hasResourceProperties('AWS::S3::BucketPolicy', {
          Bucket: 'transcription-review-media-123456789012',
        });
      });
    });

    describe('WAF WebACL', () => {
      it('creates a WAF WebACL', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
          Scope: 'REGIONAL',
        });
      });

      it('creates a WAF WebACL with rate limit rule', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
          Rules: Match.arrayWith([
            Match.objectLike({
              Name: 'RateLimitRule',
              Action: { Block: {} },
              Statement: {
                RateBasedStatement: {
                  Limit: 2000,
                  AggregateKeyType: 'IP',
                },
              },
            }),
          ]),
        });
      });

      it('creates a WAF WebACL with IP allowlist rule when CIDRs are provided', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
          Rules: Match.arrayWith([
            Match.objectLike({
              Name: 'IPAllowlistRule',
              Action: { Allow: {} },
              Statement: {
                IPSetReferenceStatement: {
                  Arn: Match.anyValue(),
                },
              },
            }),
          ]),
        });
      });

      it('sets default action to BLOCK when IP allowlist is active', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
          DefaultAction: { Block: {} },
        });
      });
    });

    describe('WAF IP Set', () => {
      it('creates a WAF IP set', () => {
        template.hasResourceProperties('AWS::WAFv2::IPSet', {
          IPAddressVersion: 'IPV4',
          Scope: 'REGIONAL',
          Addresses: ['203.0.113.0/24', '198.51.100.0/24'],
        });
      });
    });

    describe('API Gateway CloudFront Origin', () => {
      it('adds /api/* behavior when apiGatewayEndpoint is provided', () => {
        const app = new cdk.App();
        const stack = new CdnStack(app, 'TestCdnStackWithApi', {
          env: { account: '123456789012', region: 'ap-northeast-1' },
          staticBucketName: 'transcription-review-data-123456789012',
          staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
          mediaBucketName: 'transcription-review-media-123456789012',
          mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
          allowedIpCidrs: [],
          apiGatewayEndpoint: 'https://abc123.execute-api.ap-northeast-1.amazonaws.com',
        });
        const t = Template.fromStack(stack);
        t.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: Match.objectLike({
            CacheBehaviors: Match.arrayWith([
              Match.objectLike({
                PathPattern: '/api/*',
                ViewerProtocolPolicy: 'redirect-to-https',
              }),
            ]),
          }),
        });
      });

      it('sets CloudFront WAF WebACL when cloudFrontWebAclArn is provided', () => {
        const app = new cdk.App();
        const stack = new CdnStack(app, 'TestCdnStackWithWaf', {
          env: { account: '123456789012', region: 'ap-northeast-1' },
          staticBucketName: 'transcription-review-data-123456789012',
          staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
          mediaBucketName: 'transcription-review-media-123456789012',
          mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
          allowedIpCidrs: [],
          cloudFrontWebAclArn: 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/test-WebACL/abc123',
        });
        const t = Template.fromStack(stack);
        t.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: Match.objectLike({
            WebACLId: 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/test-WebACL/abc123',
          }),
        });
      });
    });

    describe('CloudFormation Outputs', () => {
      it('outputs BasePath as / when not specified', () => {
        template.hasOutput('BasePath', {
          Value: '/',
        });
      });
    });
  });

  describe('with existing CloudFront distribution (import, no basePath)', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new CdnStack(app, 'TestCdnStackImport', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        staticBucketName: 'transcription-review-data-123456789012',
        staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
        mediaBucketName: 'transcription-review-media-123456789012',
        mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
        allowedIpCidrs: [],
        cloudFrontDistributionId: 'E1234567890ABC',
      });
      template = Template.fromStack(stack);
    });

    it('does not create any new CloudFront distribution', () => {
      template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    });

    it('outputs the imported distribution ID', () => {
      template.hasOutput('DistributionId', {
        Value: 'E1234567890ABC',
      });
    });
  });

  describe('with basePath (new distribution)', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new CdnStack(app, 'TestCdnStackBasePath', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        staticBucketName: 'transcription-review-data-123456789012',
        staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
        mediaBucketName: 'transcription-review-media-123456789012',
        mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
        allowedIpCidrs: [],
        basePath: 'transcription-review',
      });
      template = Template.fromStack(stack);
    });

    it('sets S3 origin path to basePath', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          Origins: Match.arrayWith([
            Match.objectLike({
              OriginPath: '/transcription-review',
            }),
          ]),
        }),
      });
    });

    // The S3 origin already prepends basePath via OriginPath, so the error-response
    // path (a viewer-side URL path) must NOT repeat basePath. Repeating it would
    // resolve to s3://bucket/{basePath}/{basePath}/index.html and break the fallback.
    it('SPA fallback does not repeat basePath for 404 errors', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CustomErrorResponses: Match.arrayWith([
            Match.objectLike({
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: '/index.html',
            }),
          ]),
        }),
      });
    });

    it('SPA fallback does not repeat basePath for 403 errors', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CustomErrorResponses: Match.arrayWith([
            Match.objectLike({
              ErrorCode: 403,
              ResponseCode: 200,
              ResponsePagePath: '/index.html',
            }),
          ]),
        }),
      });
    });

    it('outputs the basePath value', () => {
      template.hasOutput('BasePath', {
        Value: 'transcription-review',
      });
    });
  });

  describe('without IP allowlist', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new CdnStack(app, 'TestCdnStackNoIp', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        staticBucketName: 'transcription-review-data-123456789012',
        staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
        mediaBucketName: 'transcription-review-media-123456789012',
        mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
        allowedIpCidrs: [],
      });
      template = Template.fromStack(stack);
    });

    it('sets default action to ALLOW when no IP allowlist is configured', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        DefaultAction: { Allow: {} },
      });
    });

    it('still creates rate limit rule for DDoS protection', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'RateLimitRule',
          }),
        ]),
      });
    });
  });

  describe('with existing distribution + basePath', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new CdnStack(app, 'TestCdnStackImportBasePath', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        staticBucketName: 'transcription-review-data-123456789012',
        staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
        mediaBucketName: 'transcription-review-media-123456789012',
        mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
        allowedIpCidrs: ['10.0.0.0/8'],
        cloudFrontDistributionId: 'EABCDEF1234567',
        basePath: 'review-app',
      });
      template = Template.fromStack(stack);
    });

    it('does not create a new distribution', () => {
      template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    });

    it('creates a CloudFront Function for SPA URL rewriting', () => {
      template.hasResourceProperties('AWS::CloudFront::Function', {
        Name: Match.stringLikeRegexp('SpaRewrite'),
        FunctionConfig: Match.objectLike({
          Comment: Match.stringLikeRegexp('review-app'),
          Runtime: 'cloudfront-js-2.0',
        }),
      });
    });

    it('creates a Custom Resource to update the existing distribution', () => {
      template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        DistributionId: 'EABCDEF1234567',
        BasePath: 'review-app',
        MediaBucketDomainName: Match.stringLikeRegexp('transcription-review-media'),
      });
    });

    it('creates OACs for both static and media buckets', () => {
      // Two OACs: one for static, one for media
      template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2);
    });

    it('creates bucket policies for both static and media buckets', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        Bucket: 'transcription-review-data-123456789012',
      });
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        Bucket: 'transcription-review-media-123456789012',
      });
    });

    it('outputs the basePath value', () => {
      template.hasOutput('BasePath', {
        Value: 'review-app',
      });
    });

    it('outputs the imported distribution ID', () => {
      template.hasOutput('DistributionId', {
        Value: 'EABCDEF1234567',
      });
    });

    it('still creates WAF with IP allowlist', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        DefaultAction: { Block: {} },
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'IPAllowlistRule',
          }),
        ]),
      });
    });
  });
});

describe('WafRateLimit Construct', () => {
  it('creates auth rate limit rule with correct limit (5/min = 25 per 5-min window)', () => {
    const construct = new WafRateLimit(new cdk.App(), 'TestWafRateLimit', {
      authRateLimitPerFiveMinutes: 25,
      generalRateLimitPerFiveMinutes: 500,
      scope: 'REGIONAL',
    });

    expect(construct.authRateRule.name).toBe('AuthRateLimitRule');
    expect(
      (construct.authRateRule.statement as { rateBasedStatement: { limit: number } })
        .rateBasedStatement.limit,
    ).toBe(25);
  });

  it('creates general rate limit rule with correct limit (100/min = 500 per 5-min window)', () => {
    const construct = new WafRateLimit(new cdk.App(), 'TestWafRateLimit', {
      authRateLimitPerFiveMinutes: 25,
      generalRateLimitPerFiveMinutes: 500,
      scope: 'REGIONAL',
    });

    expect(construct.generalRateRule.name).toBe('GeneralRateLimitRule');
    expect(
      (construct.generalRateRule.statement as { rateBasedStatement: { limit: number } })
        .rateBasedStatement.limit,
    ).toBe(500);
  });

  it('auth rate limit scopes down to /auth path', () => {
    const construct = new WafRateLimit(new cdk.App(), 'TestWafRateLimit', {
      authRateLimitPerFiveMinutes: 25,
      generalRateLimitPerFiveMinutes: 500,
    });

    const statement = construct.authRateRule.statement as {
      rateBasedStatement: {
        scopeDownStatement: {
          byteMatchStatement: { searchString: string; positionalConstraint: string };
        };
      };
    };
    expect(statement.rateBasedStatement.scopeDownStatement.byteMatchStatement.searchString).toBe('/auth');
    expect(statement.rateBasedStatement.scopeDownStatement.byteMatchStatement.positionalConstraint).toBe('STARTS_WITH');
  });

  it('auth rate limit blocks by IP', () => {
    const construct = new WafRateLimit(new cdk.App(), 'TestWafRateLimit', {
      authRateLimitPerFiveMinutes: 25,
      generalRateLimitPerFiveMinutes: 500,
    });

    const statement = construct.authRateRule.statement as {
      rateBasedStatement: { aggregateKeyType: string };
    };
    expect(statement.rateBasedStatement.aggregateKeyType).toBe('IP');
  });

  it('general rate limit blocks by IP', () => {
    const construct = new WafRateLimit(new cdk.App(), 'TestWafRateLimit', {
      authRateLimitPerFiveMinutes: 25,
      generalRateLimitPerFiveMinutes: 500,
    });

    const statement = construct.generalRateRule.statement as {
      rateBasedStatement: { aggregateKeyType: string };
    };
    expect(statement.rateBasedStatement.aggregateKeyType).toBe('IP');
  });

  it('both rules have block action', () => {
    const construct = new WafRateLimit(new cdk.App(), 'TestWafRateLimit', {
      authRateLimitPerFiveMinutes: 25,
      generalRateLimitPerFiveMinutes: 500,
    });

    expect(construct.authRateRule.action).toEqual({ block: {} });
    expect(construct.generalRateRule.action).toEqual({ block: {} });
  });
});
