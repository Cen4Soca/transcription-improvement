import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, beforeAll, expect } from 'vitest';
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { CdnStack } from '../lib/stacks/cdn-stack';
import { APP_LAMBDA_RUNTIME, ESBUILD_NODE_TARGET } from '../lib/constructs/lambda-runtime';

const EXPECTED_RUNTIME = 'nodejs26.x';
const ENV = { account: '123456789012', region: 'ap-northeast-1' };

type FunctionResources = Record<string, { Properties?: { Runtime?: string } }>;

/**
 * Singleton Lambdas that aws-cdk-lib provisions for its own constructs
 * (BucketDeployment, AwsCustomResource, log retention, ...). Their runtime is
 * chosen by the CDK library, not by this app, so they are out of scope.
 */
const CDK_MANAGED_FUNCTION_PREFIXES = [
  'CustomCDK',
  'AWS679f53fac002430cb0da5b7982bd2287',
  'LogRetention',
];

/** Collect app-defined AWS::Lambda::Function resources keyed by logical ID. */
function lambdaFunctions(template: Template): FunctionResources {
  const all = template.findResources('AWS::Lambda::Function') as FunctionResources;
  return Object.fromEntries(
    Object.entries(all).filter(
      ([logicalId]) => !CDK_MANAGED_FUNCTION_PREFIXES.some((prefix) => logicalId.startsWith(prefix)),
    ),
  );
}

/** True when some function's logical ID starts with the given construct ID. */
function hasFunction(functions: FunctionResources, constructId: string): boolean {
  return Object.keys(functions).some((logicalId) => logicalId.startsWith(constructId));
}

/**
 * Feature: nodejs-26-runtime-upgrade, Property 1: ランタイムの単一性
 *
 * **Validates: Requirements 2.1, 2.2, 2.4, 3.1**
 * Every AWS::Lambda::Function synthesized by FoundationStack, ApiStack and
 * CdnStack (including Custom Resource handlers) uses the nodejs26.x runtime.
 */
describe('Feature: nodejs-26-runtime-upgrade, Property 1: Lambda runtime uniformity', () => {
  let foundation: FunctionResources;
  let api: FunctionResources;
  let cdn: FunctionResources;

  beforeAll(() => {
    // FoundationStack with initialAdminEmail -> SeedAdminHandler
    const foundationApp = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
        initialAdminEmail: 'admin@example.com',
      },
    });
    const foundationStack = new FoundationStack(foundationApp, 'TestFoundationStack', { env: ENV });
    foundation = lambdaFunctions(Template.fromStack(foundationStack));

    // ApiStack without externally managed key pair -> CloudFrontKeyPairHandler,
    // S3NotificationHandler (unconditional)
    const apiApp = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
        bedrockModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      },
    });
    const apiFoundation = new FoundationStack(apiApp, 'TestFoundationStack', { env: ENV });
    const apiStack = new ApiStack(apiApp, 'TestApiStack', {
      env: ENV,
      table: apiFoundation.table,
      mediaBucket: apiFoundation.mediaBucket,
      dataBucket: apiFoundation.dataBucket,
      kmsKey: apiFoundation.kmsKey,
      userPool: apiFoundation.userPool,
      userPoolClient: apiFoundation.userPoolClient,
    });
    api = lambdaFunctions(Template.fromStack(apiStack));

    // CdnStack in import mode with basePath and Cognito ids
    // -> UpdateDistributionHandler, CallbackUrlHandler
    const cdnApp = new cdk.App();
    const cdnStack = new CdnStack(cdnApp, 'TestCdnStack', {
      env: ENV,
      staticBucketName: 'transcription-review-data-123456789012',
      staticBucketArn: 'arn:aws:s3:::transcription-review-data-123456789012',
      mediaBucketName: 'transcription-review-media-123456789012',
      mediaBucketArn: 'arn:aws:s3:::transcription-review-media-123456789012',
      allowedIpCidrs: [],
      cloudFrontDistributionId: 'E1234567890ABC',
      basePath: 'review-app',
      userPoolId: 'ap-northeast-1_ExistingPool',
      userPoolClientId: 'existing-client-id-12345',
    });
    cdn = lambdaFunctions(Template.fromStack(cdnStack));
  });

  it('synthesizes every Custom Resource handler (guards against an empty check)', () => {
    expect(hasFunction(foundation, 'SeedAdminHandler')).toBe(true);
    expect(hasFunction(api, 'CloudFrontKeyPairHandler')).toBe(true);
    expect(hasFunction(api, 'S3NotificationHandler')).toBe(true);
    expect(hasFunction(cdn, 'UpdateDistributionHandler')).toBe(true);
    expect(hasFunction(cdn, 'CallbackUrlHandler')).toBe(true);
  });

  it('APP_LAMBDA_RUNTIME resolves to nodejs26.x', () => {
    expect(APP_LAMBDA_RUNTIME.name).toBe(EXPECTED_RUNTIME);
  });

  it.each([
    ['FoundationStack', () => foundation],
    ['ApiStack', () => api],
    ['CdnStack', () => cdn],
  ])('%s: all AWS::Lambda::Function resources use nodejs26.x', (_name, getFunctions) => {
    const functions = getFunctions();
    const entries = Object.entries(functions);
    expect(entries.length).toBeGreaterThan(0);
    const offenders = entries
      .filter(([, resource]) => resource.Properties?.Runtime !== EXPECTED_RUNTIME)
      .map(([logicalId, resource]) => `${logicalId}: ${resource.Properties?.Runtime}`);
    expect(offenders).toEqual([]);
  });
});

/** Recursively list .ts files under a directory. */
function listTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Feature: nodejs-26-runtime-upgrade, Property 2: ランタイムとバンドルターゲットの整合
 *
 * **Validates: Requirements 2.1, 2.2, 2.4, 3.1**
 * The esbuild target major equals the Lambda runtime major, and no Node.js
 * version literal exists in infra/lib outside lambda-runtime.ts.
 */
describe('Feature: nodejs-26-runtime-upgrade, Property 2: runtime and bundle target consistency', () => {
  it('ESBUILD_NODE_TARGET major equals APP_LAMBDA_RUNTIME major', () => {
    const runtimeMajor = /^nodejs(\d+)\.x$/.exec(APP_LAMBDA_RUNTIME.name)?.[1];
    const targetMajor = /^node(\d+)$/.exec(ESBUILD_NODE_TARGET)?.[1];
    expect(runtimeMajor).toBeDefined();
    expect(targetMajor).toBeDefined();
    expect(targetMajor).toBe(runtimeMajor);
  });

  it('infra/lib has no hard-coded Node.js version outside lambda-runtime.ts', () => {
    const libDir = path.resolve(__dirname, '../lib');
    const files = listTsFiles(libDir).filter((file) => path.basename(file) !== 'lambda-runtime.ts');
    expect(files.length).toBeGreaterThan(0);

    const pattern = /NODEJS_\d+_X|['"]node\d+['"]/;
    const offenders = files.flatMap((file) =>
      fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .map((line, index) => ({ line, lineNo: index + 1 }))
        .filter(({ line }) => pattern.test(line))
        .map(({ line, lineNo }) => `${path.relative(libDir, file)}:${lineNo}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
