import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { WafIpAllowlist } from '../constructs/waf-ip-allowlist';
import { WafRateLimit } from '../constructs/waf-rate-limit';

export interface CdnStackProps extends cdk.StackProps {
  /** S3 bucket name for static files (React SPA) */
  staticBucketName: string;
  /** S3 bucket ARN for static files */
  staticBucketArn: string;
  /** S3 bucket name for media files (audio/video) */
  mediaBucketName: string;
  /** S3 bucket ARN for media files */
  mediaBucketArn: string;
  /** API Gateway HTTP API endpoint URL (e.g., https://abc123.execute-api.ap-northeast-1.amazonaws.com) */
  apiGatewayEndpoint?: string;
  /** List of allowed IP CIDR blocks */
  allowedIpCidrs: string[];
  /** Rate limit per 5-minute window per IP (default: 2000) @deprecated use wafRegionalIpRateLimitPerFiveMinutes */
  rateLimitPerFiveMinutes?: number;
  /** Auth-endpoint rate limit per 5-minute window per IP for the REGIONAL WafRateLimit construct (default: 25) */
  wafAuthRateLimitPerFiveMinutes?: number;
  /** General-endpoint rate limit per 5-minute window per IP for the REGIONAL WafRateLimit construct (default: 500) */
  wafGeneralRateLimitPerFiveMinutes?: number;
  /** Rate limit per 5-minute window per IP for the REGIONAL WafIpAllowlist WebACL (default: 2000) */
  wafRegionalIpRateLimitPerFiveMinutes?: number;
  /** Country codes for CloudFront geoRestriction allowlist (empty = no geo restriction) */
  geoAllowlistCountries?: string[];
  /** Existing CloudFront Distribution ID to import (empty = create new) */
  cloudFrontDistributionId?: string;
  /** Base path for the SPA within the CloudFront distribution (empty = root) */
  basePath?: string;
  /** CloudFront-scoped WAF WebACL ARN (from us-east-1 stack) */
  cloudFrontWebAclArn?: string;
  /** KMS key for S3 encryption (required for BucketDeployment) */
  kmsKey?: cdk.aws_kms.IKey;
  /** Cognito User Pool ID (for runtime config) */
  userPoolId?: string;
  /** Cognito User Pool Client ID (for runtime config) */
  userPoolClientId?: string;
}

export class CdnStack extends cdk.Stack {
  public readonly distribution: cloudfront.IDistribution;
  public readonly wafIpAllowlist: WafIpAllowlist;
  public readonly wafRateLimit: WafRateLimit;
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);

    const distributionId = props.cloudFrontDistributionId || '';
    const basePath = props.basePath || '';

    // Import S3 buckets by name (avoids cross-stack cyclic dependency)
    const staticBucket = s3.Bucket.fromBucketAttributes(this, 'StaticBucket', {
      bucketName: props.staticBucketName,
      bucketArn: props.staticBucketArn,
    });

    const mediaBucket = s3.Bucket.fromBucketAttributes(this, 'MediaBucket', {
      bucketName: props.mediaBucketName,
      bucketArn: props.mediaBucketArn,
    });

    // WAF Rate Limit Construct (REGIONAL - for reference/future use)
    this.wafRateLimit = new WafRateLimit(this, 'WafRateLimit', {
      authRateLimitPerFiveMinutes: props.wafAuthRateLimitPerFiveMinutes ?? 25,   // 5/min * 5 = 25 per 5-min window
      generalRateLimitPerFiveMinutes: props.wafGeneralRateLimitPerFiveMinutes ?? 500, // 100/min * 5 = 500 per 5-min window
      scope: 'REGIONAL',
    });

    // WAF v2 WebACL (Regional scope for ap-northeast-1 - for non-CloudFront resources)
    this.wafIpAllowlist = new WafIpAllowlist(this, 'WafIpAllowlist', {
      allowedIpCidrs: props.allowedIpCidrs,
      rateLimitPerFiveMinutes:
        props.wafRegionalIpRateLimitPerFiveMinutes ?? props.rateLimitPerFiveMinutes,
      scope: 'REGIONAL',
    });

    this.webAclArn = this.wafIpAllowlist.webAcl.attrArn;

    // CloudFront Distribution
    // Conditional: import existing or create new
    if (distributionId) {
      // Import existing distribution
      this.distribution = cloudfront.Distribution.fromDistributionAttributes(
        this,
        'ImportedStaticDistribution',
        {
          distributionId,
          domainName: `${distributionId}.cloudfront.net`,
        },
      );

      // When basePath is specified, add a cache behavior to the existing distribution
      // using a Custom Resource that updates the distribution via CloudFront API
      if (basePath) {
        // CloudFront Function for SPA routing under basePath
        // Rewrites requests to /{basePath}/index.html for client-side routing
        const spaRewriteFunction = new cloudfront.Function(this, 'SpaRewriteFunction', {
          functionName: `${id}-SpaRewrite`,
          comment: `SPA URL rewrite for /${basePath}/ path`,
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var basePath = '/${basePath}';

  // If the URI matches the basePath root, serve index.html
  if (uri === basePath || uri === basePath + '/') {
    request.uri = basePath + '/index.html';
    return request;
  }

  // If the URI starts with basePath and has no file extension, serve index.html (SPA routing)
  if (uri.startsWith(basePath + '/')) {
    var subPath = uri.substring(basePath.length + 1);
    if (subPath.lastIndexOf('.') === -1 || subPath.lastIndexOf('.') < subPath.lastIndexOf('/')) {
      request.uri = basePath + '/index.html';
    }
  }

  return request;
}
`),
          runtime: cloudfront.FunctionRuntime.JS_2_0,
        });
        // RETAIN on teardown: keep import-path resources so `cdk destroy` reaches
        // DELETE_COMPLETE instead of DELETE_FAILED on the shared distribution.
        (spaRewriteFunction.node.defaultChild as cdk.CfnResource).applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

        // S3 Origin Access Control for the existing distribution
        const importedOac = new cloudfront.S3OriginAccessControl(this, 'ImportedStaticOAC', {
          description: `OAC for existing distribution basePath: ${basePath}`,
        });
        (importedOac.node.defaultChild as cdk.CfnResource).applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

        // Custom Resource Lambda to update the existing CloudFront distribution
        const updateDistributionRole = new iam.Role(this, 'UpdateDistributionRole', {
          assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          ],
        });

        updateDistributionRole.addToPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'cloudfront:GetDistribution',
              'cloudfront:GetDistributionConfig',
              'cloudfront:UpdateDistribution',
            ],
            resources: [`arn:aws:cloudfront::${this.account}:distribution/${distributionId}`],
          }),
        );

        const updateDistributionHandler = new cdk.aws_lambda.Function(this, 'UpdateDistributionHandler', {
          runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
          handler: 'index.handler',
          role: updateDistributionRole,
          timeout: cdk.Duration.seconds(120),
          code: cdk.aws_lambda.Code.fromInline(`
const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
const response = require('cfn-response');

exports.handler = async (event, context) => {
  const cf = new CloudFrontClient({});
  const props = event.ResourceProperties;
  const distributionId = props.DistributionId;
  const basePath = props.BasePath;
  const bucketDomainName = props.BucketDomainName;
  const mediaBucketDomainName = props.MediaBucketDomainName;
  const oacId = props.OacId;
  const mediaOacId = props.MediaOacId;
  const functionArn = props.FunctionArn;

  // Use a stable physical resource ID to prevent unwanted Delete calls on update
  const physicalResourceId = 'update-distribution-' + distributionId + '-' + basePath;

  // Handle Delete early — skip CloudFront updates on resource replacement
  if (event.RequestType === 'Delete') {
    await response.send(event, context, response.SUCCESS, { Message: 'Delete acknowledged' }, physicalResourceId);
    return;
  }

  try {
    // Get current distribution config
    const getConfigResult = await cf.send(new GetDistributionConfigCommand({ Id: distributionId }));
    const config = getConfigResult.DistributionConfig;
    const etag = getConfigResult.ETag;

    // Create or Update
    const originId = 'S3-' + basePath;
    const pathPattern = '/' + basePath + '/*';
    const mediaOriginId = 'S3-media';
    const mediaPattern = '/media/*';

    // Add S3 origins if not exists
    if (!config.Origins) {
      config.Origins = { Quantity: 0, Items: [] };
    }
    if (!config.Origins.Items) {
      config.Origins.Items = [];
    }

    // Static origin
    const existingOriginIndex = config.Origins.Items.findIndex(o => o.Id === originId);
    const originConfig = {
      Id: originId,
      DomainName: bucketDomainName,
      OriginPath: '',
      S3OriginConfig: { OriginAccessIdentity: '' },
      OriginAccessControlId: oacId,
      CustomHeaders: { Quantity: 0, Items: [] },
      ConnectionAttempts: 3,
      ConnectionTimeout: 10,
      OriginShield: { Enabled: false },
    };    if (existingOriginIndex >= 0) {
      config.Origins.Items[existingOriginIndex] = originConfig;
    } else {
      config.Origins.Items.push(originConfig);
    }

    // Media origin
    const existingMediaOriginIndex = config.Origins.Items.findIndex(o => o.Id === mediaOriginId);
    const mediaOriginConfig = {
      Id: mediaOriginId,
      DomainName: mediaBucketDomainName,
      OriginPath: '',
      S3OriginConfig: { OriginAccessIdentity: '' },
      OriginAccessControlId: mediaOacId,
      CustomHeaders: { Quantity: 0, Items: [] },
      ConnectionAttempts: 3,
      ConnectionTimeout: 10,
      OriginShield: { Enabled: false },
    };
    if (existingMediaOriginIndex >= 0) {
      config.Origins.Items[existingMediaOriginIndex] = mediaOriginConfig;
    } else {
      config.Origins.Items.push(mediaOriginConfig);
    }

    config.Origins.Quantity = config.Origins.Items.length;

    // Add cache behaviors
    if (!config.CacheBehaviors) {
      config.CacheBehaviors = { Quantity: 0, Items: [] };
    }
    if (!config.CacheBehaviors.Items) {
      config.CacheBehaviors.Items = [];
    }

    // Static behavior - derived from DefaultCacheBehavior to include all required fields
    const existingBehaviorIndex = config.CacheBehaviors.Items.findIndex(
      b => b.PathPattern === pathPattern
    );
    const behaviorConfig = Object.assign({}, config.DefaultCacheBehavior, {
      PathPattern: pathPattern,
      TargetOriginId: originId,
      ViewerProtocolPolicy: 'redirect-to-https',
      AllowedMethods: {
        Quantity: 2,
        Items: ['GET', 'HEAD'],
        CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
      },
      Compress: true,
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
      LambdaFunctionAssociations: { Quantity: 0, Items: [] },
      FunctionAssociations: {
        Quantity: 1,
        Items: [{ EventType: 'viewer-request', FunctionARN: functionArn }],
      },
      TrustedSigners: { Enabled: false, Quantity: 0 },
      TrustedKeyGroups: { Enabled: false, Quantity: 0 },
      SmoothStreaming: false,
      FieldLevelEncryptionId: '',
    });
    if (existingBehaviorIndex >= 0) {
      config.CacheBehaviors.Items[existingBehaviorIndex] = behaviorConfig;
    } else {
      config.CacheBehaviors.Items.push(behaviorConfig);
    }

    // Media behavior - derived from DefaultCacheBehavior to include all required fields
    const existingMediaBehaviorIndex = config.CacheBehaviors.Items.findIndex(
      b => b.PathPattern === mediaPattern
    );
    const mediaBehaviorConfig = Object.assign({}, config.DefaultCacheBehavior, {
      PathPattern: mediaPattern,
      TargetOriginId: mediaOriginId,
      ViewerProtocolPolicy: 'redirect-to-https',
      AllowedMethods: {
        Quantity: 2,
        Items: ['GET', 'HEAD'],
        CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
      },
      Compress: false,
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
      LambdaFunctionAssociations: { Quantity: 0, Items: [] },
      FunctionAssociations: { Quantity: 0, Items: [] },
      TrustedSigners: { Enabled: false, Quantity: 0 },
      TrustedKeyGroups: { Enabled: false, Quantity: 0 },
      SmoothStreaming: false,
      FieldLevelEncryptionId: '',
    });
    if (existingMediaBehaviorIndex >= 0) {
      config.CacheBehaviors.Items[existingMediaBehaviorIndex] = mediaBehaviorConfig;
    } else {
      config.CacheBehaviors.Items.push(mediaBehaviorConfig);
    }

    config.CacheBehaviors.Quantity = config.CacheBehaviors.Items.length;

    // NOTE: CustomErrorResponses are intentionally left untouched.
    //
    // CustomErrorResponses are distribution-wide, NOT per-cache-behavior. On a shared
    // distribution, overwriting them hijacks the co-hosted app's SPA fallback
    // (e.g. rewriting 403 -> /{basePath}/index.html breaks the root app's deep links).
    // SPA routing for our basePath is already handled by the viewer-request
    // CloudFront Function (SpaRewriteFunction), which rewrites extension-less URIs
    // under /{basePath}/ to /{basePath}/index.html before the origin is hit.
    // Therefore no error-response mapping is needed on our side.

    await cf.send(new UpdateDistributionCommand({
      Id: distributionId,
      DistributionConfig: config,
      IfMatch: etag,
    }));

    await response.send(event, context, response.SUCCESS, {
      Message: 'Behaviors added/updated',
      PathPattern: pathPattern,
    }, physicalResourceId);
  } catch (e) {
    console.error('Error:', e);
    await response.send(event, context, response.FAILED, { Error: e.message }, physicalResourceId);
  }
};
`),
        });

        // Media OAC for existing distribution
        const importedMediaOac = new cloudfront.S3OriginAccessControl(this, 'ImportedMediaOAC', {
          description: `OAC for existing distribution media files`,
        });
        (importedMediaOac.node.defaultChild as cdk.CfnResource).applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

        new cdk.CustomResource(this, 'UpdateExistingDistribution', {
          serviceToken: updateDistributionHandler.functionArn,
          properties: {
            DistributionId: distributionId,
            BasePath: basePath,
            BucketDomainName: `${props.staticBucketName}.s3.${this.region}.amazonaws.com`,
            MediaBucketDomainName: `${props.mediaBucketName}.s3.${this.region}.amazonaws.com`,
            OacId: importedOac.originAccessControlId,
            MediaOacId: importedMediaOac.originAccessControlId,
            FunctionArn: spaRewriteFunction.functionArn,
            Version: '4',
          },
        });

        // Grant CloudFront OAC access to static S3 bucket for the existing distribution
        const importedStaticBucketPolicy = new s3.CfnBucketPolicy(this, 'ImportedStaticBucketPolicy', {
          bucket: props.staticBucketName,
          policyDocument: new iam.PolicyDocument({
            statements: [new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
              actions: ['s3:GetObject'],
              resources: [`${props.staticBucketArn}/*`],
              conditions: {
                StringEquals: {
                  'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distributionId}`,
                },
              },
            })],
          }),
        });
        importedStaticBucketPolicy.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

        // Grant CloudFront OAC access to media S3 bucket for the existing distribution
        const importedMediaBucketPolicy = new s3.CfnBucketPolicy(this, 'ImportedMediaBucketPolicy', {
          bucket: props.mediaBucketName,
          policyDocument: new iam.PolicyDocument({
            statements: [new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
              actions: ['s3:GetObject'],
              resources: [`${props.mediaBucketArn}/*`],
              conditions: {
                StringEquals: {
                  'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distributionId}`,
                },
              },
            })],
          }),
        });
        importedMediaBucketPolicy.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
      }
    } else {
      // Create new distribution with S3 origin and BasePath support.
      //
      // On a dedicated distribution, basePath is only an S3 key prefix: the origin's
      // originPath already prepends it, so the SPA is served from the distribution ROOT.
      // Error-response paths are viewer-side URL paths and must therefore NOT repeat
      // basePath, otherwise the fallback resolves to s3://bucket/{basePath}/{basePath}/index.html.
      // Consequently the frontend must be built with base '/' (no VITE_BASE_PATH) here.
      const originPath = basePath ? `/${basePath}` : undefined;
      const spaFallbackPath = '/index.html';

      const staticOac = new cloudfront.S3OriginAccessControl(this, 'StaticOAC', {
        description: 'OAC for static files',
      });

      const mediaOac = new cloudfront.S3OriginAccessControl(this, 'MediaOAC', {
        description: 'OAC for media files',
      });

      // Response Headers Policy with Content Security Policy (Req 14.20, 22.6)
      const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
        responseHeadersPolicyName: `${id}-SecurityHeaders`,
        comment: 'Security headers including CSP for Transcription Review App',
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com; media-src 'self' https://*.cloudfront.net; frame-ancestors 'none'",
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.seconds(63072000),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
        },
      });

      // Build additional behaviors
      const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {};

      // Media files behavior: /media/* → mediaBucket
      additionalBehaviors['/media/*'] = {
        origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket, {
          originAccessControl: mediaOac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      };

      // API Gateway behavior (if provided)
      if (props.apiGatewayEndpoint) {
        const apiDomain = props.apiGatewayEndpoint.replace(/^https?:\/\//, '');

        const apiOrigin = new origins.HttpOrigin(apiDomain, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
        });

        // Cache policy for API: no caching, forward Authorization header
        const apiCachePolicy = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
          cachePolicyName: `${id}-ApiNoCache`,
          comment: 'No cache for API requests - forward Authorization header',
          defaultTtl: cdk.Duration.seconds(0),
          minTtl: cdk.Duration.seconds(0),
          maxTtl: cdk.Duration.seconds(0),
          headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
            'Authorization',
          ),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        });

        const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
          originRequestPolicyName: `${id}-ApiOriginRequest`,
          comment: 'Forward headers and query strings to API Gateway',
          headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
            'Content-Type',
            'Accept',
          ),
          queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
          cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
        });

        additionalBehaviors['/api/*'] = {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: apiCachePolicy,
          originRequestPolicy: apiOriginRequestPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        };
      }

      // CloudFront geoRestriction: apply an allowlist only when country codes are
      // configured. An empty array means no geo restriction (omit the property).
      const geoAllowlistCountries = props.geoAllowlistCountries ?? ['JP'];
      const geoRestriction = geoAllowlistCountries.length
        ? cloudfront.GeoRestriction.allowlist(...geoAllowlistCountries)
        : undefined;

      const newDistribution = new cloudfront.Distribution(this, 'StaticDistribution', {
        comment: 'Transcription Review App - SPA + Media + API',
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(staticBucket, {
            originAccessControl: staticOac,
            originPath,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          responseHeadersPolicy,
        },
        additionalBehaviors,
        defaultRootObject: 'index.html',
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: spaFallbackPath,
            ttl: cdk.Duration.seconds(0),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: spaFallbackPath,
            ttl: cdk.Duration.seconds(0),
          },
        ],
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        webAclId: props.cloudFrontWebAclArn,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        httpVersion: cloudfront.HttpVersion.HTTP2,
        ...(geoRestriction ? { geoRestriction } : {}),
      });

      // Grant CloudFront OAC access to static S3 bucket
      new s3.CfnBucketPolicy(this, 'StaticBucketPolicy', {
        bucket: props.staticBucketName,
        policyDocument: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
            actions: ['s3:GetObject'],
            resources: [`${props.staticBucketArn}/*`],
            conditions: {
              StringEquals: {
                'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${newDistribution.distributionId}`,
              },
            },
          })],
        }),
      });

      // Grant CloudFront OAC access to media S3 bucket
      new s3.CfnBucketPolicy(this, 'MediaBucketPolicy', {
        bucket: props.mediaBucketName,
        policyDocument: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
            actions: ['s3:GetObject'],
            resources: [`${props.mediaBucketArn}/*`],
            conditions: {
              StringEquals: {
                'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${newDistribution.distributionId}`,
              },
            },
          })],
        }),
      });

      this.distribution = newDistribution;
    }

    // --- Frontend BucketDeployment ---
    // Deploy frontend build output to S3 under basePath prefix
    const destinationKeyPrefix = basePath || undefined;

    // Runtime config: resolve Cognito domain via DescribeUserPool and generate aws-config.json
    // This allows the frontend to know the Cognito domain without hardcoding in .env
    const runtimeConfigSources: s3deploy.ISource[] = [s3deploy.Source.asset('../frontend/dist')];

    if (props.userPoolId) {
      const describeUserPoolCr = new cdk.custom_resources.AwsCustomResource(this, 'DescribeUserPoolDomain', {
        onCreate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'describeUserPool',
          parameters: { UserPoolId: props.userPoolId },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(`describe-pool-${props.userPoolId}`),
          outputPaths: ['UserPool.Domain'],
        },
        onUpdate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'describeUserPool',
          parameters: { UserPoolId: props.userPoolId },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(`describe-pool-${props.userPoolId}`),
          outputPaths: ['UserPool.Domain'],
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['cognito-idp:DescribeUserPool'],
            resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`],
          }),
        ]),
      });

      const cognitoDomain = describeUserPoolCr.getResponseField('UserPool.Domain');
      const cognitoFullDomain = `${cognitoDomain}.auth.${this.region}.amazoncognito.com`;

      runtimeConfigSources.push(
        s3deploy.Source.jsonData('aws-config.json', {
          userPoolId: props.userPoolId,
          userPoolClientId: props.userPoolClientId || '',
          cognitoDomain: cognitoFullDomain,
          apiEndpoint: props.apiGatewayEndpoint || '',
          region: this.region,
        })
      );
    }

    const deployment = new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: runtimeConfigSources,
      destinationBucket: staticBucket,
      destinationKeyPrefix,
      distribution: this.distribution,
      distributionPaths: basePath ? [`/${basePath}/*`] : ['/*'],
      prune: true,
      ...(props.kmsKey
        ? {
            serverSideEncryption: s3deploy.ServerSideEncryption.AWS_KMS,
            serverSideEncryptionAwsKmsKeyId: props.kmsKey.keyId,
          }
        : {}),
    });

    // Grant the BucketDeployment Lambda permission to use the KMS key
    if (props.kmsKey) {
      props.kmsKey.grant(
        deployment.handlerRole,
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:DescribeKey',
      );
    }

    // --- Cognito Callback URL Registration (Custom Resource) ---
    // Registers this app's callback/logout URL on the Cognito User Pool Client.
    // Works for both imported and newly-created distributions.
    // For shared User Pool scenarios: adds URL without removing other apps' existing URLs.
    if (props.userPoolId && props.userPoolClientId) {
      const actualDistributionId = this.distribution.distributionId;

      const callbackUrlRole = new iam.Role(this, 'CallbackUrlRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
      callbackUrlRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cognito-idp:DescribeUserPoolClient',
            'cognito-idp:UpdateUserPoolClient',
          ],
          resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`],
        })
      );
      callbackUrlRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cloudfront:GetDistribution'],
          resources: [`arn:aws:cloudfront::${this.account}:distribution/${actualDistributionId}`],
        })
      );

      const callbackUrlHandler = new cdk.aws_lambda.Function(this, 'CallbackUrlHandler', {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        role: callbackUrlRole,
        timeout: cdk.Duration.seconds(30),
        code: cdk.aws_lambda.Code.fromInline(`
const { CognitoIdentityProviderClient, DescribeUserPoolClientCommand, UpdateUserPoolClientCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { CloudFrontClient, GetDistributionCommand } = require('@aws-sdk/client-cloudfront');
const response = require('cfn-response');

exports.handler = async (event, context) => {
  const { UserPoolId, UserPoolClientId, DistributionId, BasePath, Region } = event.ResourceProperties;

  try {
    const cfClient = new CloudFrontClient({ region: 'us-east-1' });
    const cognitoClient = new CognitoIdentityProviderClient({ region: Region });

    // Get CloudFront domain name
    const distResult = await cfClient.send(new GetDistributionCommand({ Id: DistributionId }));
    const domainName = distResult.Distribution.DomainName;
    const appUrl = BasePath
      ? 'https://' + domainName + '/' + BasePath + '/'
      : 'https://' + domainName + '/';

    if (event.RequestType === 'Delete') {
      // Remove our callback URL on stack deletion
      const descResult = await cognitoClient.send(new DescribeUserPoolClientCommand({
        UserPoolId, ClientId: UserPoolClientId,
      }));
      const clientConfig = descResult.UserPoolClient;
      const callbacks = (clientConfig.CallbackURLs || []).filter(u => u !== appUrl);
      const logouts = (clientConfig.LogoutURLs || []).filter(u => u !== appUrl);

      // Ensure at least one URL remains (Cognito requires it for OAuth clients)
      const finalCallbacks = callbacks.length > 0 ? callbacks : ['https://localhost/'];
      const finalLogouts = logouts.length > 0 ? logouts : ['https://localhost/'];

      await cognitoClient.send(new UpdateUserPoolClientCommand({
        UserPoolId,
        ClientId: UserPoolClientId,
        CallbackURLs: finalCallbacks,
        LogoutURLs: finalLogouts,
        AllowedOAuthFlows: clientConfig.AllowedOAuthFlows,
        AllowedOAuthFlowsUserPoolClient: clientConfig.AllowedOAuthFlowsUserPoolClient,
        AllowedOAuthScopes: clientConfig.AllowedOAuthScopes,
        SupportedIdentityProviders: clientConfig.SupportedIdentityProviders,
        ExplicitAuthFlows: clientConfig.ExplicitAuthFlows,
        PreventUserExistenceErrors: clientConfig.PreventUserExistenceErrors,
        AccessTokenValidity: clientConfig.AccessTokenValidity,
        IdTokenValidity: clientConfig.IdTokenValidity,
        RefreshTokenValidity: clientConfig.RefreshTokenValidity,
        TokenValidityUnits: clientConfig.TokenValidityUnits,
      }));

      console.log('Removed callback URL:', appUrl);
      await response.send(event, context, response.SUCCESS);
      return;
    }

    // Create or Update: Add our callback URL (preserving existing URLs from other apps)
    const descResult = await cognitoClient.send(new DescribeUserPoolClientCommand({
      UserPoolId, ClientId: UserPoolClientId,
    }));
    const clientConfig = descResult.UserPoolClient;
    const callbacks = clientConfig.CallbackURLs || [];
    const logouts = clientConfig.LogoutURLs || [];

    let updated = false;
    if (!callbacks.includes(appUrl)) {
      callbacks.push(appUrl);
      updated = true;
    }
    if (!logouts.includes(appUrl)) {
      logouts.push(appUrl);
      updated = true;
    }

    // Remove placeholder localhost URL if a real URL is now present
    const cleanCallbacks = callbacks.filter(u => u !== 'https://localhost/' || callbacks.length === 1);
    const cleanLogouts = logouts.filter(u => u !== 'https://localhost/' || logouts.length === 1);
    if (cleanCallbacks.length !== callbacks.length || cleanLogouts.length !== logouts.length) {
      updated = true;
    }

    if (updated) {
      await cognitoClient.send(new UpdateUserPoolClientCommand({
        UserPoolId,
        ClientId: UserPoolClientId,
        CallbackURLs: cleanCallbacks,
        LogoutURLs: cleanLogouts,
        AllowedOAuthFlows: clientConfig.AllowedOAuthFlows,
        AllowedOAuthFlowsUserPoolClient: clientConfig.AllowedOAuthFlowsUserPoolClient,
        AllowedOAuthScopes: clientConfig.AllowedOAuthScopes,
        SupportedIdentityProviders: clientConfig.SupportedIdentityProviders,
        ExplicitAuthFlows: clientConfig.ExplicitAuthFlows,
        PreventUserExistenceErrors: clientConfig.PreventUserExistenceErrors,
        AccessTokenValidity: clientConfig.AccessTokenValidity,
        IdTokenValidity: clientConfig.IdTokenValidity,
        RefreshTokenValidity: clientConfig.RefreshTokenValidity,
        TokenValidityUnits: clientConfig.TokenValidityUnits,
      }));
      console.log('Added callback URL:', appUrl);
    } else {
      console.log('Callback URL already registered:', appUrl);
    }

    await response.send(event, context, response.SUCCESS, { CallbackUrl: appUrl });
  } catch (err) {
    console.error('Failed to update callback URLs:', err);
    await response.send(event, context, response.FAILED);
  }
};
        `),
      });

      new cdk.CustomResource(this, 'RegisterCallbackUrl', {
        serviceToken: callbackUrlHandler.functionArn,
        properties: {
          UserPoolId: props.userPoolId,
          UserPoolClientId: props.userPoolClientId,
          DistributionId: actualDistributionId,
          BasePath: basePath,
          Region: this.region,
        },
      });
    }

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      exportName: `${id}-DistributionDomainName`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: `${id}-DistributionId`,
    });

    new cdk.CfnOutput(this, 'BasePath', {
      value: basePath || '/',
      exportName: `${id}-BasePath`,
      description: 'Base path for the SPA within the CloudFront distribution',
    });

    new cdk.CfnOutput(this, 'RegionalWebAclArn', {
      value: this.wafIpAllowlist.webAcl.attrArn,
      exportName: `${id}-RegionalWebAclArn`,
    });
  }
}
