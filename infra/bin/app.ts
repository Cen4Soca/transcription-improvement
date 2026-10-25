#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { CdnStack } from '../lib/stacks/cdn-stack';
import { CloudFrontWafStack } from '../lib/stacks/cloudfront-waf-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') as string || 'dev';
const account = app.node.tryGetContext('account') as string
  || process.env.CDK_DEFAULT_ACCOUNT;
const region = app.node.tryGetContext('region') as string || 'ap-northeast-1';
const allowedIpCidrs = app.node.tryGetContext('allowedIpCidrs') as string[] || [];
const cloudFrontDistributionId = app.node.tryGetContext('cloudFrontDistributionId') as string || '';
const cloudFrontKeyPairId = app.node.tryGetContext('cloudFrontKeyPairId') as string || '';
const cloudFrontPrivateKeyParam = app.node.tryGetContext('cloudFrontPrivateKeyParam') as string || '';
const basePath = app.node.tryGetContext('basePath') as string || '';
const transcribeDataAccessRoleArn = app.node.tryGetContext('transcribeDataAccessRoleArn') as string || '';

// Validated numeric context reader: Number() + Number.isInteger + lower-bound guard + fallback.
// Mirrors the mediaGlacierTransitionDays pattern in foundation-stack.ts.
const readPositiveIntContext = (key: string, fallback: number): number => {
  const parsed = Number(app.node.tryGetContext(key));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
};

// WAF rate limits (per 5-minute window per IP)
const wafAuthRateLimitPer5Min = readPositiveIntContext('wafAuthRateLimitPer5Min', 25);
const wafGeneralRateLimitPer5Min = readPositiveIntContext('wafGeneralRateLimitPer5Min', 500);
const wafGeneralIpRateLimitPer5Min = readPositiveIntContext('wafGeneralIpRateLimitPer5Min', 2000);
// WAF managed rule action: 'count' (default, observe) or 'block' (enforce).
const wafManagedRuleAction =
  (app.node.tryGetContext('wafManagedRuleAction') as string) === 'block' ? 'block' : 'count';

// Monitoring alarm thresholds
const alarmLambdaErrorRatePercent = readPositiveIntContext('alarmLambdaErrorRatePercent', 5);
const alarmDynamoThrottleCount = readPositiveIntContext('alarmDynamoThrottleCount', 10);
const alarm4xxRatePercent = readPositiveIntContext('alarm4xxRatePercent', 10);
const alarm5xxRatePercent = readPositiveIntContext('alarm5xxRatePercent', 1);

// CloudFront geoRestriction allowlist (country codes; empty = no restriction)
const cloudFrontGeoAllowlist = app.node.tryGetContext('cloudFrontGeoAllowlist') as string[] || ['JP'];

const awsEnv: cdk.Environment = {
  account,
  region,
};

// CloudFront WAF Stack - must be deployed in us-east-1 (CLOUDFRONT scope requirement)
const cloudFrontWafStack = new CloudFrontWafStack(app, `${env}-CloudFrontWafStack`, {
  env: {
    account,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
  description: 'CloudFront WAF resources: WebACL with IP allowlist and rate limiting (us-east-1)',
  allowedIpCidrs,
  authRateLimitPerFiveMinutes: wafAuthRateLimitPer5Min,
  generalRateLimitPerFiveMinutes: wafGeneralRateLimitPer5Min,
  managedRuleAction: wafManagedRuleAction,
});

const foundationStack = new FoundationStack(app, `${env}-FoundationStack`, {
  env: awsEnv,
  description: 'Foundation resources: KMS, S3, DynamoDB, Cognito',
});

const apiStack = new ApiStack(app, `${env}-ApiStack`, {
  env: awsEnv,
  description: 'API resources: Lambda, API Gateway HTTP API, EventBridge',
  table: foundationStack.table,
  mediaBucket: foundationStack.mediaBucket,
  dataBucket: foundationStack.dataBucket,
  kmsKey: foundationStack.kmsKey,
  userPool: foundationStack.userPool,
  userPoolClient: foundationStack.userPoolClient,
  allowedIpCidrs,
  cloudFrontDomain: cloudFrontDistributionId
    ? `${cloudFrontDistributionId}.cloudfront.net`
    : undefined,
  cloudFrontKeyPairId: cloudFrontKeyPairId || undefined,
  cloudFrontPrivateKeyParam: cloudFrontPrivateKeyParam || undefined,
  transcribeDataAccessRoleArn: transcribeDataAccessRoleArn || undefined,
});
apiStack.addDependency(foundationStack);

const cdnStack = new CdnStack(app, `${env}-CdnStack`, {
  env: awsEnv,
  crossRegionReferences: true,
  description: 'CDN resources: CloudFront, WAF v2',
  staticBucketName: foundationStack.staticBucket.bucketName,
  staticBucketArn: foundationStack.staticBucket.bucketArn,
  mediaBucketName: foundationStack.mediaBucket.bucketName,
  mediaBucketArn: foundationStack.mediaBucket.bucketArn,
  malwareScanRoleArn: apiStack.malwareScanRoleArn,
  apiGatewayEndpoint: apiStack.httpApi.apiEndpoint,
  allowedIpCidrs,
  cloudFrontDistributionId,
  basePath,
  cloudFrontWebAclArn: cloudFrontWafStack.webAclArn,
  kmsKey: foundationStack.kmsKey,
  userPoolId: foundationStack.userPool.userPoolId,
  userPoolClientId: foundationStack.userPoolClient.userPoolClientId,
  wafAuthRateLimitPerFiveMinutes: wafAuthRateLimitPer5Min,
  wafGeneralRateLimitPerFiveMinutes: wafGeneralRateLimitPer5Min,
  wafRegionalIpRateLimitPerFiveMinutes: wafGeneralIpRateLimitPer5Min,
  geoAllowlistCountries: cloudFrontGeoAllowlist,
});
cdnStack.addDependency(apiStack);
cdnStack.addDependency(cloudFrontWafStack);

const monitoringStack = new MonitoringStack(app, `${env}-MonitoringStack`, {
  env: awsEnv,
  description: 'Monitoring resources: CloudWatch, alarms',
  apiId: apiStack.httpApi.apiId,
  apiName: apiStack.httpApi.httpApiName || 'TranscriptionReviewApi',
  tableName: foundationStack.table.tableName,
  lambdaFunctionNames: [
    'transcription-review-get-sessions',
    'transcription-review-post-corrections',
    'transcription-review-upload-url',
    'transcription-review-process-upload',
    'transcription-review-start-transcription',
    'transcription-review-process-job-complete',
    'transcription-review-consensus-aggregation',
    'transcription-review-malware-scan',
  ],
  lambdaErrorRatePercent: alarmLambdaErrorRatePercent,
  dynamoThrottleCount: alarmDynamoThrottleCount,
  fourxxRatePercent: alarm4xxRatePercent,
  fivexxRatePercent: alarm5xxRatePercent,
});
monitoringStack.addDependency(cdnStack);

app.synth();
