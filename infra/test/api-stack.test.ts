import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { describe, it, beforeAll, expect } from 'vitest';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { BedrockComprehend } from '../lib/constructs/bedrock-comprehend';

/**
 * **Validates: Requirements 14.1**
 */

describe('ApiStack - Snapshot', () => {
  it('matches the snapshot', () => {
    const app = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
        bedrockModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      },
    });

    const foundationStack = new FoundationStack(app, 'TestFoundationStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });

    const apiStack = new ApiStack(app, 'TestApiStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      table: foundationStack.table,
      mediaBucket: foundationStack.mediaBucket,
      dataBucket: foundationStack.dataBucket,
      kmsKey: foundationStack.kmsKey,
      userPool: foundationStack.userPool,
      userPoolClient: foundationStack.userPoolClient,
    });

    const template = Template.fromStack(apiStack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});

describe('ApiStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
        bedrockModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      },
    });

    const foundationStack = new FoundationStack(app, 'TestFoundationStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });

    const apiStack = new ApiStack(app, 'TestApiStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      table: foundationStack.table,
      mediaBucket: foundationStack.mediaBucket,
      dataBucket: foundationStack.dataBucket,
      kmsKey: foundationStack.kmsKey,
      userPool: foundationStack.userPool,
      userPoolClient: foundationStack.userPoolClient,
    });

    template = Template.fromStack(apiStack);
  });

  describe('API Gateway HTTP API', () => {
    it('creates an HTTP API', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        Name: 'TranscriptionReviewApi',
        ProtocolType: 'HTTP',
      });
    });

    it('creates a JWT Authorizer for Cognito', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
        AuthorizerType: 'JWT',
        IdentitySource: ['$request.header.Authorization'],
        JwtConfiguration: Match.objectLike({
          Audience: Match.anyValue(),
        }),
      });
    });

    it('creates API routes', () => {
      // Verify key routes exist
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /sessions',
      });
    });
  });

  describe('Lambda Functions', () => {
    it('creates Lambda functions with Node.js 24.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs24.x',
      });
    });

    it('creates Lambda functions with individual IAM roles', () => {
      // Each Lambda function should have its own role
      const roles = template.findResources('AWS::IAM::Role', {
        Properties: {
          AssumeRolePolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Principal: {
                  Service: 'lambda.amazonaws.com',
                },
              }),
            ]),
          },
        },
      });
      // Multiple Lambda roles should exist
      expect(Object.keys(roles).length).toBeGreaterThan(1);
    });

    it('creates Lambda functions with X-Ray tracing enabled', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        TracingConfig: {
          Mode: 'Active',
        },
      });
    });
  });

  describe('EventBridge', () => {
    it('creates a custom event bus', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'TranscriptionReviewAppBus',
      });
    });

    it('creates CorrectionConfirmed rule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['transcription-review-app'],
          'detail-type': ['CorrectionConfirmed'],
        },
      });
    });

    it('creates ConsensusResultConfirmed rule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['transcription-review-app'],
          'detail-type': ['ConsensusResultConfirmed'],
        },
      });
    });
  });
});


describe('ApiStack - Transcription Workflow Resources', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
        bedrockModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      },
    });

    const foundationStack = new FoundationStack(app, 'TestFoundationStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });

    const apiStack = new ApiStack(app, 'TestApiStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      table: foundationStack.table,
      mediaBucket: foundationStack.mediaBucket,
      dataBucket: foundationStack.dataBucket,
      kmsKey: foundationStack.kmsKey,
      userPool: foundationStack.userPool,
      userPoolClient: foundationStack.userPoolClient,
    });

    template = Template.fromStack(apiStack);
  });

  describe('New Lambda Functions', () => {
    it('creates upload-url Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*upload-url.*'),
      });
    });

    it('creates get-media-files Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*media-files.*'),
      });
    });

    it('creates start-transcription Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*transcription-jobs.*Start.*'),
      });
    });

    it('creates get-job-status Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*job.*status.*'),
      });
    });

    it('creates download-transcription Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*download.*'),
      });
    });

    it('creates create-language-model Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*language-models.*Create.*'),
      });
    });

    it('creates list-language-models Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*language-models.*List.*'),
      });
    });

    it('creates get-model-status Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*model.*status.*'),
      });
    });

    it('creates delete-media Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*Delete.*media.*'),
      });
    });

    it('creates delete-transcription Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*Delete.*transcription.*'),
      });
    });

    it('creates process-upload Lambda function (S3 event triggered)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*S3 Event.*ObjectCreated.*'),
      });
    });

    it('creates process-job-complete Lambda function (EventBridge triggered)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*EventBridge.*Transcribe.*'),
      });
    });
  });

  describe('New API Routes', () => {
    it('creates POST /upload-url route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /upload-url',
      });
    });

    it('creates GET /media-files route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /media-files',
      });
    });

    it('creates DELETE /media-files/{mediaFileId} route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'DELETE /media-files/{mediaFileId}',
      });
    });

    it('creates POST /transcription-jobs route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /transcription-jobs',
      });
    });

    it('creates GET /transcription-jobs/{jobId} route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /transcription-jobs/{jobId}',
      });
    });

    it('creates GET /sessions/{sessionId}/download route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /sessions/{sessionId}/download',
      });
    });

    it('creates GET /language-models route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /language-models',
      });
    });

    it('creates POST /language-models route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /language-models',
      });
    });

    it('creates GET /language-models/{modelName} route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /language-models/{modelName}',
      });
    });

    it('creates DELETE /sessions/{sessionId}/transcription route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'DELETE /sessions/{sessionId}/transcription',
      });
    });
  });

  describe('Speaker Label Routes', () => {
    it('creates POST /sessions/{sessionId}/speaker-labels route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /sessions/{sessionId}/speaker-labels',
      });
    });

    it('creates DELETE /sessions/{sessionId}/speaker-labels/{label} route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'DELETE /sessions/{sessionId}/speaker-labels/{label}',
      });
    });

    it('creates the add speaker label Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*speaker-labels.*Add.*'),
      });
    });

    it('creates the delete speaker label Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*speaker-labels.*Delete.*'),
      });
    });
  });

  describe('Self-Assign Routes', () => {
    it('creates GET /sessions/joinable route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /sessions/joinable',
      });
    });

    it('creates POST /sessions/{sessionId}/self-assign route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /sessions/{sessionId}/self-assign',
      });
    });

    it('creates the joinable sessions Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*joinable.*'),
      });
    });

    it('creates the self-assign Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*self-assign.*'),
      });
    });

    it('creates POST /sessions/{sessionId}/reopen route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /sessions/{sessionId}/reopen',
      });
    });
  });

  describe('Session Name Routes', () => {
    it('creates PATCH /sessions/{sessionId}/name route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'PATCH /sessions/{sessionId}/name',
      });
    });

    it('creates GET /sessions/{sessionId}/name-suggestion route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /sessions/{sessionId}/name-suggestion',
      });
    });

    it('passes BEDROCK_MODEL_ID to the name-suggestion Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*name-suggestion.*'),
        Environment: {
          Variables: Match.objectLike({
            BEDROCK_MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
          }),
        },
      });
    });
  });

  describe('EventBridge Rule - Transcribe Job Completion', () => {
    it('creates a rule for Transcribe job state changes on default bus', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['aws.transcribe'],
          'detail-type': ['Transcribe Job State Change'],
          detail: {
            TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
          },
        },
      });
    });

    it('creates the rule with a descriptive name', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'TranscribeJobCompleted-ProcessJobComplete',
      });
    });

    it('targets the process-job-complete Lambda function', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'TranscribeJobCompleted-ProcessJobComplete',
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
          }),
        ]),
      });
    });
  });

  describe('S3 Event Notification', () => {
    it('grants S3 permission to invoke process-upload Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        Principal: 's3.amazonaws.com',
      });
    });

    it('creates a custom resource for S3 bucket notification configuration', () => {
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        BucketName: Match.anyValue(),
        LambdaArn: Match.anyValue(),
      });
    });
  });

  describe('Dead Letter Queue (DLQ)', () => {
    it('creates a DLQ for process-upload Lambda', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'transcription-review-process-upload-dlq',
      });
    });

    it('creates the DLQ with 14-day retention period', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'transcription-review-process-upload-dlq',
        MessageRetentionPeriod: 1209600,
      });
    });

    it('creates the DLQ with KMS encryption', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'transcription-review-process-upload-dlq',
        KmsMasterKeyId: Match.anyValue(),
      });
    });
  });

  describe('IAM Permissions for new Lambda functions', () => {
    it('grants Transcribe StartTranscriptionJob permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'transcribe:StartTranscriptionJob',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('grants Transcribe GetTranscriptionJob permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'transcribe:GetTranscriptionJob',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('grants Transcribe CreateLanguageModel and ListLanguageModels permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: ['transcribe:CreateLanguageModel', 'transcribe:ListLanguageModels'],
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('grants SQS SendMessage permission for DLQ', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sqs:SendMessage',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('Malware Scan', () => {
    it('creates a malware scan Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'transcription-review-malware-scan',
        Description: Match.stringLikeRegexp('.*malware.*'),
      });
    });

    it('creates a malware scan IAM role with S3 access', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:CopyObject'],
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('creates EventBridge rule for S3ObjectCreated to trigger malware scan', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'S3ObjectCreated-MalwareScan',
        EventPattern: {
          source: ['transcription-review-app'],
          'detail-type': ['S3ObjectCreated'],
        },
      });
    });
  });

  // The media bucket's scanStatus Deny policy is now owned by CdnStack (single
  // BucketPolicy owner per CloudFront-exposed bucket). See cdn-stack.test.ts for
  // its coverage. ApiStack no longer emits a media bucket policy.
  describe('S3 Bucket Policy for PENDING scanStatus', () => {
    it('no longer emits a media bucket policy from ApiStack', () => {
      const policies = template.findResources('AWS::S3::BucketPolicy');
      expect(Object.keys(policies)).toHaveLength(0);
    });
  });

  describe('Profile Routes', () => {
    it('creates PATCH /me route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'PATCH /me',
      });
    });

    it('creates update-me Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*PATCH /me.*'),
      });
    });
  });

  describe('Admin Settings Routes', () => {
    it('creates GET /admin/settings/ranking route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /admin/settings/ranking',
      });
    });

    it('creates PATCH /admin/settings/ranking route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'PATCH /admin/settings/ranking',
      });
    });

    it('creates PATCH /admin/settings/consensus route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'PATCH /admin/settings/consensus',
      });
    });
  });

  describe('Admin Audit Log Routes', () => {
    it('creates GET /admin/audit-logs route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /admin/audit-logs',
      });
    });

    // Frontend (admin-api.ts deleteAuditLogs) calls POST /admin/audit-logs/delete.
    it('creates POST /admin/audit-logs/delete route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /admin/audit-logs/delete',
      });
    });

    it('creates DELETE /admin/audit-logs route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'DELETE /admin/audit-logs',
      });
    });
  });

  describe('Bedrock + Comprehend Permissions', () => {
    it('grants Bedrock InvokeModel permission to suggestions Lambda', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowBedrockInvokeModel',
              Effect: 'Allow',
              Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            }),
          ]),
        },
      });
    });

    it('grants Comprehend Detect permissions to suggestions Lambda', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowComprehendDetect',
              Effect: 'Allow',
              Action: Match.arrayWith([
                'comprehend:DetectEntities',
                'comprehend:DetectKeyPhrases',
              ]),
            }),
          ]),
        },
      });
    });

    /**
     * bedrockModelId context を指定しない場合、既定で JP 推論プロファイルが
     * 選択され、Suggestions Lambda の環境変数と IAM リソースに反映されること。
     * バックエンド (`suggestion-service.ts`) の既定値と一致している必要がある。
     */
    it('defaults to the JP inference profile when no bedrockModelId context is set', () => {
      const app = new cdk.App({
        context: {
          kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
        },
      });
      const foundationStack = new FoundationStack(app, 'DefaultFoundationStack', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
      });
      const apiStack = new ApiStack(app, 'DefaultApiStack', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        table: foundationStack.table,
        mediaBucket: foundationStack.mediaBucket,
        dataBucket: foundationStack.dataBucket,
        kmsKey: foundationStack.kmsKey,
        userPool: foundationStack.userPool,
        userPoolClient: foundationStack.userPoolClient,
      });
      const defaultTemplate = Template.fromStack(apiStack);

      // Suggestions Lambda receives the inference profile ID as BEDROCK_MODEL_ID.
      defaultTemplate.hasResourceProperties('AWS::Lambda::Function', {
        Description: Match.stringLikeRegexp('.*suggestions.*'),
        Environment: {
          Variables: Match.objectLike({
            BEDROCK_MODEL_ID: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
          }),
        },
      });

      // IAM policy authorizes both the inference profile and the underlying
      // foundation model across destination regions.
      defaultTemplate.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowBedrockInvokeModel',
              Effect: 'Allow',
              Resource: Match.arrayWith([
                'arn:aws:bedrock:ap-northeast-1:123456789012:inference-profile/jp.anthropic.claude-haiku-4-5-20251001-v1:0',
                'arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
                'arn:aws:bedrock:ap-northeast-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
              ]),
            }),
          ]),
        },
      });
    });
  });
});

describe('BedrockComprehend construct', () => {
  /**
   * JP 推論プロファイルを渡した場合、inference-profile ARN は ap-northeast-1
   * スコープになり、foundation-model ARN は JP の宛先リージョン
   * (ap-northeast-1 / ap-northeast-3) 分だけ許可されること。
   */
  it('grants ap-northeast-1-scoped inference-profile and JP foundation-model ARNs for a JP profile', () => {
    const stack = new cdk.Stack(undefined, 'BedrockJpProfileStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    const bc = new BedrockComprehend(stack, 'BedrockComprehend', {
      bedrockModelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
      region: 'ap-northeast-1',
      accountId: '123456789012',
    });
    const role = new Role(stack, 'TestRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    bc.grantInvoke(role);

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowBedrockInvokeModel',
            Effect: 'Allow',
            Resource: Match.arrayWith([
              'arn:aws:bedrock:ap-northeast-1:123456789012:inference-profile/jp.anthropic.claude-haiku-4-5-20251001-v1:0',
              'arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
              'arn:aws:bedrock:ap-northeast-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
            ]),
          }),
        ]),
      },
    });
  });

  /**
   * EU 推論プロファイルを渡した場合、inference-profile ARN は eu-central-1
   * スコープ（ソースリージョン）になり、foundation-model ARN は EU の宛先
   * リージョン分が許可されること。EU データレジデンシー対応の肝。
   */
  it('grants eu-central-1-scoped inference-profile and EU foundation-model ARNs for an EU profile', () => {
    const stack = new cdk.Stack(undefined, 'BedrockEuProfileStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    const bc = new BedrockComprehend(stack, 'BedrockComprehend', {
      bedrockModelId: 'eu.anthropic.claude-sonnet-5-5',
      region: 'ap-northeast-1',
      accountId: '123456789012',
    });
    const role = new Role(stack, 'TestRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    bc.grantInvoke(role);

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowBedrockInvokeModel',
            Effect: 'Allow',
            Resource: Match.arrayWith([
              'arn:aws:bedrock:eu-central-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-5-5',
              'arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-sonnet-5-5',
              'arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-sonnet-5-5',
              'arn:aws:bedrock:eu-west-3::foundation-model/anthropic.claude-sonnet-5-5',
              'arn:aws:bedrock:eu-north-1::foundation-model/anthropic.claude-sonnet-5-5',
              'arn:aws:bedrock:eu-south-1::foundation-model/anthropic.claude-sonnet-5-5',
              'arn:aws:bedrock:eu-south-2::foundation-model/anthropic.claude-sonnet-5-5',
            ]),
          }),
        ]),
      },
    });
  });

  /**
   * JP/EU 以外の推論プロファイルプレフィックス (us./apac./global.) は
   * データレジデンシー方針に反するため synth 時に throw すること。
   */
  it('throws for an unsupported inference-profile prefix', () => {
    const stack = new cdk.Stack(undefined, 'BedrockUnsupportedStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });

    expect(
      () =>
        new BedrockComprehend(stack, 'BedrockComprehend', {
          bedrockModelId: 'global.anthropic.claude-sonnet-5-5',
          region: 'ap-northeast-1',
          accountId: '123456789012',
        })
    ).toThrow(/Only JP \(jp\.\) and EU \(eu\.\) geographic profiles are supported/);
  });

  it('grants only the in-region foundation-model ARN for a bare foundation-model ID', () => {
    const stack = new cdk.Stack(undefined, 'BedrockBareStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    const bc = new BedrockComprehend(stack, 'BedrockComprehend', {
      bedrockModelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      region: 'ap-northeast-1',
      accountId: '123456789012',
    });
    const role = new Role(stack, 'TestRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    bc.grantInvoke(role);

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowBedrockInvokeModel',
            Effect: 'Allow',
            Resource: 'arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0',
          }),
        ]),
      },
    });
  });
});
