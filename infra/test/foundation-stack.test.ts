import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { describe, it, beforeAll, expect } from 'vitest';
import { FoundationStack } from '../lib/stacks/foundation-stack';

/**
 * **Validates: Requirements 14.1, 14.18, 14.21, 14.23, 15.1, 15.2**
 */

describe('FoundationStack - Snapshot', () => {
  it('matches the snapshot for new creation mode', () => {
    const app = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
      },
    });
    const stack = new FoundationStack(app, 'TestFoundationStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });

  it('matches the snapshot for import mode', () => {
    const app = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
        cognitoUserPoolId: 'ap-northeast-1_ExistingPool',
        cognitoUserPoolClientId: 'existing-client-id-12345',
      },
    });
    const stack = new FoundationStack(app, 'TestFoundationStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});

describe('FoundationStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
      },
    });
    const stack = new FoundationStack(app, 'TestFoundationStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    template = Template.fromStack(stack);
  });

  describe('KMS Key', () => {
    it('creates a KMS key with rotation enabled', () => {
      template.hasResourceProperties('AWS::KMS::Key', {
        EnableKeyRotation: true,
      });
    });

    it('creates a KMS key alias', () => {
      template.hasResourceProperties('AWS::KMS::Alias', {
        AliasName: 'alias/transcription-review-app',
      });
    });
  });

  describe('DynamoDB Table', () => {
    it('creates a table with PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('creates a table with KMS encryption', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        SSESpecification: {
          SSEEnabled: true,
          SSEType: 'KMS',
        },
      });
    });

    it('creates a table with PK and SK key schema', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
      });
    });

    it('creates GSI1 with GSI1PK and GSI1SK', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });

    it('creates GSI2 with GSI2PK and GSI2SK', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });

    it('has point-in-time recovery enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });
  });

  describe('S3 Buckets', () => {
    it('creates three S3 buckets (media, data, static)', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      expect(Object.keys(buckets).length).toBe(3);
    });

    it('creates media bucket with KMS encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
              },
            },
          ],
        },
      });
    });

    it('all buckets have BlockPublicAccess fully enabled', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      for (const [, bucket] of Object.entries(buckets)) {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        expect(props.PublicAccessBlockConfiguration).toEqual({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
      }
    });

    it('no bucket has versioning enabled', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      for (const [, bucket] of Object.entries(buckets)) {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        expect(props.VersioningConfiguration).toBeUndefined();
      }
    });

    it('media bucket transitions media/ objects to GIR then Deep Archive', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Prefix: 'media/',
              Transitions: Match.arrayWith([
                Match.objectLike({ StorageClass: 'GLACIER_IR', TransitionInDays: 14 }),
                Match.objectLike({ StorageClass: 'DEEP_ARCHIVE', TransitionInDays: 104 }),
              ]),
            }),
          ]),
        },
      });
    });

    it('all buckets have a 7-day AbortIncompleteMultipartUpload rule', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      expect(Object.keys(buckets).length).toBe(3);
      for (const [, bucket] of Object.entries(buckets)) {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        const lifecycle = props.LifecycleConfiguration as { Rules: Array<Record<string, unknown>> };
        expect(lifecycle).toBeDefined();
        const hasAbort = lifecycle.Rules.some(
          (r) => (r.AbortIncompleteMultipartUpload as { DaysAfterInitiation?: number } | undefined)
            ?.DaysAfterInitiation === 7
        );
        expect(hasAbort).toBe(true);
      }
    });

    it('data bucket expires transcriptions/ objects after 30 days', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Prefix: 'transcriptions/',
              ExpirationInDays: 30,
              Status: 'Enabled',
            }),
          ]),
        },
      });
    });

    it('data bucket keeps its 7-day AbortIncompleteMultipartUpload rule alongside the expiration rule', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      const dataBuckets = Object.values(buckets).filter((bucket) => {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        const lifecycle = props.LifecycleConfiguration as
          { Rules: Array<Record<string, unknown>> } | undefined;
        const rules = lifecycle?.Rules ?? [];
        return rules.some((r) => r.Prefix === 'transcriptions/');
      });
      expect(dataBuckets.length).toBe(1);
      const props = (dataBuckets[0] as { Properties: Record<string, unknown> }).Properties;
      const rules = (props.LifecycleConfiguration as { Rules: Array<Record<string, unknown>> }).Rules;
      const hasAbort = rules.some(
        (r) => (r.AbortIncompleteMultipartUpload as { DaysAfterInitiation?: number } | undefined)
          ?.DaysAfterInitiation === 7
      );
      expect(hasAbort).toBe(true);
    });

    it('does not expire the training-data/ prefix on any bucket', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      for (const [, bucket] of Object.entries(buckets)) {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        const lifecycle = props.LifecycleConfiguration as
          { Rules: Array<Record<string, unknown>> } | undefined;
        const rules = lifecycle?.Rules ?? [];
        expect(rules.some((r) => r.Prefix === 'training-data/')).toBe(false);
      }
    });
  });

  describe('Cognito User Pool (new creation)', () => {
    it('creates a User Pool with email sign-in', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
      });
    });

    it('creates custom:role attribute with Mutable: false', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Schema: Match.arrayWith([
          Match.objectLike({
            Name: 'role',
            AttributeDataType: 'String',
            Mutable: false,
          }),
        ]),
      });
    });

    it('creates custom:displayName attribute with Mutable: true', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Schema: Match.arrayWith([
          Match.objectLike({
            Name: 'displayName',
            AttributeDataType: 'String',
            Mutable: true,
          }),
        ]),
      });
    });

    it('sets MFA to OPTIONAL mode', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        MfaConfiguration: 'OPTIONAL',
      });
    });

    it('enables TOTP as MFA second factor', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      });
    });

    it('enables Advanced Security Features in ENFORCED mode', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolAddOns: {
          AdvancedSecurityMode: 'ENFORCED',
        },
      });
    });

    it('creates a User Pool Client', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        UserPoolId: Match.anyValue(),
        GenerateSecret: false,
      });
    });

    it('User Pool Client read attributes include custom:role', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ReadAttributes: Match.arrayWith(['custom:role']),
      });
    });

    it('User Pool Client write attributes exclude custom:role', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        WriteAttributes: Match.not(Match.arrayWith(['custom:role'])),
      });
    });

    it('User Pool Client write attributes include custom:displayName', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        WriteAttributes: Match.arrayWith(['custom:displayName']),
      });
    });
  });
});

describe('FoundationStack - Cognito conditional import', () => {
  describe('when cognitoUserPoolId is specified', () => {
    let template: Template;
    let stack: FoundationStack;

    beforeAll(() => {
      const app = new cdk.App({
        context: {
          kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
          cognitoUserPoolId: 'ap-northeast-1_ExistingPool',
        },
      });
      stack = new FoundationStack(app, 'TestFoundationStack', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
      });
      template = Template.fromStack(stack);
    });

    it('does not create a new UserPool resource', () => {
      const userPools = template.findResources('AWS::Cognito::UserPool');
      expect(Object.keys(userPools).length).toBe(0);
    });

    it('creates a new UserPoolClient when cognitoUserPoolClientId is not specified', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        GenerateSecret: false,
      });
    });

    it('exposes the imported UserPoolId', () => {
      expect(stack.userPool.userPoolId).toBe('ap-northeast-1_ExistingPool');
    });

    it('outputs UserPoolId in CloudFormation', () => {
      template.hasOutput('UserPoolId', {
        Value: 'ap-northeast-1_ExistingPool',
      });
    });

    it('outputs UserPoolClientId in CloudFormation', () => {
      template.hasOutput('UserPoolClientId', {
        Value: Match.anyValue(),
      });
    });
  });

  describe('when cognitoUserPoolId and cognitoUserPoolClientId are both specified', () => {
    let template: Template;
    let stack: FoundationStack;

    beforeAll(() => {
      const app = new cdk.App({
        context: {
          kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
          cognitoUserPoolId: 'ap-northeast-1_ExistingPool',
          cognitoUserPoolClientId: 'existing-client-id-12345',
        },
      });
      stack = new FoundationStack(app, 'TestFoundationStack', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
      });
      template = Template.fromStack(stack);
    });

    it('does not create a new UserPool resource', () => {
      const userPools = template.findResources('AWS::Cognito::UserPool');
      expect(Object.keys(userPools).length).toBe(0);
    });

    it('does not create a new UserPoolClient resource', () => {
      const clients = template.findResources('AWS::Cognito::UserPoolClient');
      expect(Object.keys(clients).length).toBe(0);
    });

    it('exposes the imported UserPoolId', () => {
      expect(stack.userPool.userPoolId).toBe('ap-northeast-1_ExistingPool');
    });

    it('exposes the imported UserPoolClientId', () => {
      expect(stack.userPoolClient.userPoolClientId).toBe('existing-client-id-12345');
    });

    it('outputs UserPoolId in CloudFormation', () => {
      template.hasOutput('UserPoolId', {
        Value: 'ap-northeast-1_ExistingPool',
      });
    });

    it('outputs UserPoolClientId in CloudFormation', () => {
      template.hasOutput('UserPoolClientId', {
        Value: 'existing-client-id-12345',
      });
    });
  });

  describe('when cognitoUserPoolId is empty string', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App({
        context: {
          kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
          cognitoUserPoolId: '',
        },
      });
      const stack = new FoundationStack(app, 'TestFoundationStack', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
      });
      template = Template.fromStack(stack);
    });

    it('creates a new UserPool', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolName: 'TranscriptionReviewAppUserPool',
      });
    });

    it('creates a new UserPoolClient', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        GenerateSecret: false,
      });
    });
  });
});

describe('FoundationStack - Region constraint', () => {
  it('deploys to ap-northeast-1', () => {
    const app = new cdk.App({
      context: {
        kmsKeyAdminArns: ['arn:aws:iam::123456789012:root'],
      },
    });
    const stack = new FoundationStack(app, 'TestFoundationStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    expect(stack.region).toBe('ap-northeast-1');
  });
});
