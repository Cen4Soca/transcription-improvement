import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { LambdaFunction } from '../constructs/lambda-function';
import { BedrockComprehend } from '../constructs/bedrock-comprehend';
import { MalwareScan } from '../constructs/malware-scan';

export interface ApiStackProps extends cdk.StackProps {
  /** DynamoDB table */
  table: dynamodb.ITable;
  /** Media S3 bucket */
  mediaBucket: s3.IBucket;
  /** Data S3 bucket */
  dataBucket: s3.IBucket;
  /** KMS key for encryption */
  kmsKey: kms.IKey;
  /** Cognito User Pool */
  userPool: cognito.IUserPool;
  /** Cognito User Pool Client */
  userPoolClient: cognito.IUserPoolClient;
  /** CloudFront distribution domain name (for signed URLs) */
  cloudFrontDomain?: string;
  /** CloudFront key pair ID for signed URLs (stored in SSM) */
  cloudFrontKeyPairId?: string;
  /** SSM parameter name for CloudFront private key */
  cloudFrontPrivateKeyParam?: string;
  /** Allowed IP CIDRs for WAF IP Set initialization */
  allowedIpCidrs?: string[];
  /** Transcribe data access IAM role ARN */
  transcribeDataAccessRoleArn?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // JP cross-region inference profile for Claude Haiku 4.5.
    // ap-northeast-1 Anthropic models only support the INFERENCE_PROFILE
    // inference type, so the bare foundation-model ID cannot be invoked
    // on-demand. Claude 3/3.5 profiles are Legacy/EOL in this account, so
    // Haiku 4.5 is the current enabled default. MUST match backend
    // `suggestion-service.ts`. Override per-env via cdk.json `bedrockModelId`.
    // Only JP (jp.) and EU (eu.) geographic profiles are supported; the
    // backend derives the Bedrock source region from this prefix. For EU data
    // residency set `eu.anthropic.claude-sonnet-5-5`.
    const bedrockModelId = this.node.tryGetContext('bedrockModelId') as string
      || 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';

    // PresignedURL expiry (seconds) for the UploadUrl Lambda.
    // Configurable via cdk.json context; falls back to 300 if unset/invalid; guarded >= 1.
    const presignedUrlExpirySecondsRaw = this.node.tryGetContext('presignedUrlExpirySeconds');
    const parsedPresignedUrlExpirySeconds = Number(presignedUrlExpirySecondsRaw);
    const presignedUrlExpirySeconds =
      Number.isInteger(parsedPresignedUrlExpirySeconds) && parsedPresignedUrlExpirySeconds >= 1
        ? parsedPresignedUrlExpirySeconds
        : 300;

    // Minimum reviewer count that triggers automatic consensus aggregation.
    // Configurable via cdk.json context; falls back to 3 if unset/invalid; guarded >= 1.
    const minReviewersForAutoConsensusRaw = this.node.tryGetContext('minReviewersForAutoConsensus');
    const parsedMinReviewers = Number(minReviewersForAutoConsensusRaw);
    const minReviewers =
      Number.isInteger(parsedMinReviewers) && parsedMinReviewers >= 1 ? parsedMinReviewers : 3;

    // --- EventBridge Custom Event Bus ---
    this.eventBus = new events.EventBus(this, 'AppEventBus', {
      eventBusName: 'TranscriptionReviewAppBus',
    });

    // --- Bedrock + Comprehend permissions construct ---
    const bedrockComprehend = new BedrockComprehend(this, 'BedrockComprehend', {
      bedrockModelId,
      region: this.region,
      accountId: this.account,
    });

    // --- Common environment variables for Lambda functions ---
    const commonEnv: Record<string, string> = {
      DYNAMODB_TABLE_NAME: props.table.tableName,
      MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
      DATA_BUCKET_NAME: props.dataBucket.bucketName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
    };

    // --- WAF IP Set for dynamic IP allowlist management ---
    const envName = this.node.tryGetContext('env') as string || 'dev';
    const wafIpSet = new cdk.aws_wafv2.CfnIPSet(this, 'DynamicIpSet', {
      name: `TranscriptionReview-${envName}-DynamicIPAllowlist`,
      scope: 'REGIONAL',
      ipAddressVersion: 'IPV4',
      addresses: props.allowedIpCidrs ?? [],
      description: 'Dynamic IP allowlist managed by admin Lambda - max 1000 entries',
    });

    // Environment variables for IP allowlist Lambda functions
    const wafEnv: Record<string, string> = {
      WAF_IP_SET_ID: wafIpSet.attrId,
      WAF_IP_SET_NAME: wafIpSet.name!,
      WAF_SCOPE: 'REGIONAL',
    };

    // Environment variables for media URL Lambda (CloudFront signed URLs)
    // If cloudFrontKeyPairId is not provided, auto-generate a key pair via Custom Resource
    let cfKeyPairId: string;
    let cfPrivateKeyParam: string;
    const cfDomain = props.cloudFrontDomain ?? '';

    if (props.cloudFrontKeyPairId && props.cloudFrontPrivateKeyParam) {
      // Use externally managed key pair
      cfKeyPairId = props.cloudFrontKeyPairId;
      cfPrivateKeyParam = props.cloudFrontPrivateKeyParam;
    } else {
      // Auto-generate CloudFront key pair via Custom Resource
      const envName = this.node.tryGetContext('env') as string || 'dev';
      const ssmParamName = `/transcription-review/${envName}/cloudfront-private-key`;

      const keyPairRole = new iam.Role(this, 'CloudFrontKeyPairRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
      keyPairRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudfront:CreatePublicKey',
          'cloudfront:DeletePublicKey',
          'cloudfront:GetPublicKey',
          'cloudfront:CreateKeyGroup',
          'cloudfront:UpdateKeyGroup',
          'cloudfront:DeleteKeyGroup',
          'cloudfront:GetKeyGroup',
        ],
        resources: ['*'],
      }));
      keyPairRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:PutParameter',
          'ssm:DeleteParameter',
          'ssm:GetParameter',
        ],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${ssmParamName}`],
      }));
      keyPairRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey*'],
        resources: [props.kmsKey.keyArn],
      }));

      const keyPairHandler = new cdk.aws_lambda.Function(this, 'CloudFrontKeyPairHandler', {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        role: keyPairRole,
        timeout: cdk.Duration.seconds(60),
        code: cdk.aws_lambda.Code.fromInline(`
const { CloudFrontClient, CreatePublicKeyCommand, DeletePublicKeyCommand, GetPublicKeyCommand, CreateKeyGroupCommand, UpdateKeyGroupCommand, DeleteKeyGroupCommand, GetKeyGroupCommand } = require('@aws-sdk/client-cloudfront');
const { SSMClient, PutParameterCommand, DeleteParameterCommand, GetParameterCommand } = require('@aws-sdk/client-ssm');
const crypto = require('crypto');
const response = require('cfn-response');

exports.handler = async (event, context) => {
  const props = event.ResourceProperties;
  const { SsmParamName, KmsKeyId, EnvName } = props;
  const cf = new CloudFrontClient({});
  const ssm = new SSMClient({});
  const publicKeyName = 'TranscriptionReview-' + EnvName + '-SigningKey';
  const keyGroupName = 'TranscriptionReview-' + EnvName + '-KeyGroup';

  try {
    if (event.RequestType === 'Delete') {
      // Clean up: delete key group, public key, SSM param
      const oldData = event.PhysicalResourceId ? JSON.parse(event.PhysicalResourceId) : {};
      try {
        if (oldData.keyGroupId) {
          const kg = await cf.send(new GetKeyGroupCommand({ Id: oldData.keyGroupId }));
          await cf.send(new DeleteKeyGroupCommand({ Id: oldData.keyGroupId, IfMatch: kg.ETag }));
        }
      } catch (e) { console.log('KeyGroup delete skip:', e.name); }
      try {
        if (oldData.publicKeyId) {
          const pk = await cf.send(new GetPublicKeyCommand({ Id: oldData.publicKeyId }));
          await cf.send(new DeletePublicKeyCommand({ Id: oldData.publicKeyId, IfMatch: pk.ETag }));
        }
      } catch (e) { console.log('PublicKey delete skip:', e.name); }
      try {
        await ssm.send(new DeleteParameterCommand({ Name: SsmParamName }));
      } catch (e) { console.log('SSM delete skip:', e.name); }
      await response.send(event, context, response.SUCCESS, {}, event.PhysicalResourceId);
      return;
    }

    if (event.RequestType === 'Create') {
      // Generate RSA 2048 key pair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      });

      // Store private key in SSM Parameter Store (SecureString with KMS)
      await ssm.send(new PutParameterCommand({
        Name: SsmParamName,
        Value: privateKey,
        Type: 'SecureString',
        KeyId: KmsKeyId,
        Overwrite: true,
        Description: 'CloudFront signing private key for Transcription Review App',
      }));

      // Register public key with CloudFront
      const callerRef = 'tr-' + EnvName + '-' + Date.now();
      const pkResult = await cf.send(new CreatePublicKeyCommand({
        PublicKeyConfig: {
          CallerReference: callerRef,
          Name: publicKeyName,
          EncodedKey: publicKey,
          Comment: 'Auto-generated by Transcription Review CDK',
        },
      }));
      const publicKeyId = pkResult.PublicKey.Id;

      // Create Key Group
      const kgResult = await cf.send(new CreateKeyGroupCommand({
        KeyGroupConfig: {
          Name: keyGroupName,
          Items: [publicKeyId],
          Comment: 'Auto-generated key group for Transcription Review signed URLs',
        },
      }));
      const keyGroupId = kgResult.KeyGroup.Id;

      const physicalId = JSON.stringify({ publicKeyId, keyGroupId });
      await response.send(event, context, response.SUCCESS, {
        PublicKeyId: publicKeyId,
        KeyGroupId: keyGroupId,
        SsmParamName: SsmParamName,
      }, physicalId);
      return;
    }

    // Update: check if key already exists (idempotent)
    let publicKeyId, keyGroupId;
    const oldData = event.PhysicalResourceId ? JSON.parse(event.PhysicalResourceId) : {};
    if (oldData.publicKeyId) {
      try {
        await cf.send(new GetPublicKeyCommand({ Id: oldData.publicKeyId }));
        publicKeyId = oldData.publicKeyId;
        keyGroupId = oldData.keyGroupId;
      } catch (e) { /* key was deleted externally, recreate */ }
    }

    if (!publicKeyId) {
      // Recreate
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      });
      await ssm.send(new PutParameterCommand({
        Name: SsmParamName, Value: privateKey, Type: 'SecureString', KeyId: KmsKeyId, Overwrite: true,
      }));
      const callerRef = 'tr-' + EnvName + '-' + Date.now();
      const pkResult = await cf.send(new CreatePublicKeyCommand({
        PublicKeyConfig: { CallerReference: callerRef, Name: publicKeyName, EncodedKey: publicKey, Comment: 'Auto-generated by CDK' },
      }));
      publicKeyId = pkResult.PublicKey.Id;
      const kgResult = await cf.send(new CreateKeyGroupCommand({
        KeyGroupConfig: { Name: keyGroupName, Items: [publicKeyId], Comment: 'Auto-generated key group' },
      }));
      keyGroupId = kgResult.KeyGroup.Id;
    }

    const physicalId = JSON.stringify({ publicKeyId, keyGroupId });
    await response.send(event, context, response.SUCCESS, {
      PublicKeyId: publicKeyId,
      KeyGroupId: keyGroupId,
      SsmParamName: SsmParamName,
    }, physicalId);
  } catch (err) {
    console.error('Error:', err);
    await response.send(event, context, response.FAILED, { Error: err.message });
  }
};
        `),
      });

      const keyPairCr = new cdk.CustomResource(this, 'CloudFrontKeyPair', {
        serviceToken: keyPairHandler.functionArn,
        properties: {
          SsmParamName: ssmParamName,
          KmsKeyId: props.kmsKey.keyId,
          EnvName: envName,
        },
      });

      cfKeyPairId = keyPairCr.getAttString('PublicKeyId');
      cfPrivateKeyParam = ssmParamName;
    }

    const mediaUrlEnv: Record<string, string> = {
      ...(cfDomain ? { CLOUDFRONT_DOMAIN: cfDomain } : {}),
      ...(cfKeyPairId ? { CLOUDFRONT_KEY_PAIR_ID: cfKeyPairId } : {}),
      ...(cfPrivateKeyParam ? { CLOUDFRONT_PRIVATE_KEY_PARAM: cfPrivateKeyParam } : {}),
    };

    // Environment variables for language model / transcription Lambdas
    // If transcribeDataAccessRoleArn is not provided, create one automatically
    let transcribeRoleArn: string;
    if (props.transcribeDataAccessRoleArn) {
      transcribeRoleArn = props.transcribeDataAccessRoleArn;
    } else {
      const transcribeDataAccessRole = new iam.Role(this, 'TranscribeDataAccessRole', {
        description: 'Allows Amazon Transcribe to access training data in S3',
        assumedBy: new iam.ServicePrincipal('transcribe.amazonaws.com'),
      });
      transcribeDataAccessRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject', 's3:ListBucket'],
          resources: [
            props.dataBucket.bucketArn,
            `${props.dataBucket.bucketArn}/training-data/*`,
          ],
        })
      );
      transcribeDataAccessRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
          resources: [props.kmsKey.keyArn],
        })
      );
      transcribeRoleArn = transcribeDataAccessRole.roleArn;
    }
    const transcribeEnv: Record<string, string> = {
      TRANSCRIBE_DATA_ACCESS_ROLE_ARN: transcribeRoleArn,
    };

    // --- Lambda code path (TypeScript source — bundled by esbuild via NodejsFunction) ---
    const handlersDir = '../backend/src/handlers';

    // --- API Lambda Functions ---

    // Sessions
    const getSessionsFn = this.createLambda('GetSessions', {
      entry: handlersDir,
      description: 'GET /sessions - ReviewSession list',
      environment: commonEnv,
    });
    this.grantCommonPermissions(getSessionsFn, props);

    const getSessionDetailFn = this.createLambda('GetSessionDetail', {
      entry: handlersDir,
      description: 'GET /sessions/{sessionId} - ReviewSession detail',
      environment: commonEnv,
    });
    this.grantCommonPermissions(getSessionDetailFn, props);

    const patchSessionStatusFn = this.createLambda('PatchSessionStatus', {
      entry: handlersDir,
      description: 'PATCH /sessions/{sessionId}/status - Update session status',
      environment: commonEnv,
    });
    this.grantCommonPermissions(patchSessionStatusFn, props);

    const patchSessionNameFn = this.createLambda('PatchSessionName', {
      entry: handlersDir,
      description: 'PATCH /sessions/{sessionId}/name - Rename session',
      environment: commonEnv,
    });
    this.grantCommonPermissions(patchSessionNameFn, props);

    // Session assignment
    const getAssignedSessionsFn = this.createLambda('GetAssignedSessions', {
      entry: handlersDir,
      description: 'GET /sessions/assigned - Sessions assigned to the caller',
      environment: commonEnv,
    });
    this.grantCommonPermissions(getAssignedSessionsFn, props);

    const patchSessionAssignmentFn = this.createLambda('PatchSessionAssignment', {
      entry: handlersDir,
      description: 'PATCH /sessions/{sessionId}/assignment - (Re)assign a session',
      environment: commonEnv,
    });
    this.grantCommonPermissions(patchSessionAssignmentFn, props);

    const postSessionJoinFn = this.createLambda('PostSessionJoin', {
      entry: handlersDir,
      description: 'POST /sessions/{sessionId}/join - Reviewer joins a shared session',
      environment: commonEnv,
    });
    this.grantCommonPermissions(postSessionJoinFn, props);

    const getJoinableSessionsFn = this.createLambda('GetJoinableSessions', {
      entry: handlersDir,
      description: 'GET /sessions/joinable - PENDING sessions a reviewer can self-assign to',
      environment: commonEnv,
    });
    this.grantCommonPermissions(getJoinableSessionsFn, props);

    const postSessionSelfAssignFn = this.createLambda('PostSessionSelfAssign', {
      entry: handlersDir,
      description: 'POST /sessions/{sessionId}/self-assign - Reviewer self-assigns to a team session',
      environment: commonEnv,
    });
    this.grantCommonPermissions(postSessionSelfAssignFn, props);

    // Speaker labels (session master list)
    const postSpeakerLabelFn = this.createLambda('PostSpeakerLabel', {
      entry: handlersDir,
      description: 'POST /sessions/{sessionId}/speaker-labels - Add speaker label',
      environment: commonEnv,
    });
    this.grantCommonPermissions(postSpeakerLabelFn, props);

    const deleteSpeakerLabelFn = this.createLambda('DeleteSpeakerLabel', {
      entry: handlersDir,
      description:
        'DELETE /sessions/{sessionId}/speaker-labels/{label} - Delete speaker label',
      environment: commonEnv,
    });
    this.grantCommonPermissions(deleteSpeakerLabelFn, props);

    const postSessionAggregateFn = this.createLambda('PostSessionAggregate', {
      entry: handlersDir,
      description:
        'POST /sessions/{sessionId}/aggregate - ADMIN/TEAM_LEADER manual aggregation',
      environment: commonEnv,
    });
    this.grantCommonPermissions(postSessionAggregateFn, props);

    const postSessionReopenFn = this.createLambda('PostSessionReopen', {
      entry: handlersDir,
      description:
        'POST /sessions/{sessionId}/reopen - ADMIN/TEAM_LEADER reopen COMPLETED → IN_PROGRESS',
      environment: commonEnv,
    });
    this.grantCommonPermissions(postSessionReopenFn, props);

    // Segments
    const getSegmentsFn = this.createLambda('GetSegments', {
      entry: handlersDir,
      description: 'GET /sessions/{sessionId}/segments - Segment list',
      environment: commonEnv,
    });
    this.grantCommonPermissions(getSegmentsFn, props);

    // Corrections
    const postCorrectionsFn = this.createLambda('PostCorrections', {
      entry: handlersDir,
      description: 'POST /sessions/{sessionId}/corrections - Create correction',
      environment: commonEnv,
    });
    this.grantCommonPermissions(postCorrectionsFn, props);
    postCorrectionsFn.grantEventBridgePutEvents(this.eventBus.eventBusArn);

    const getCorrectionsFn = this.createLambda('GetCorrections', {
      entry: handlersDir,
      description: 'GET /sessions/{sessionId}/corrections - List corrections',
      environment: commonEnv,
    });
    this.grantCommonPermissions(getCorrectionsFn, props);

    // Suggestions (Bedrock + Comprehend)
    const getSuggestionsFn = this.createLambda('GetSuggestions', {
      entry: handlersDir,
      description: 'GET /sessions/{sessionId}/suggestions - Get suggestion candidates',
      environment: {
        ...commonEnv,
        BEDROCK_MODEL_ID: bedrockModelId,
      },
      timeoutSeconds: 60,
    });
    this.grantCommonPermissions(getSuggestionsFn, props);
    bedrockComprehend.grantInvoke(getSuggestionsFn.role);

    const getSessionNameSuggestionFn = this.createLambda('GetSessionNameSuggestion', {
      entry: handlersDir,
      description: 'GET /sessions/{sessionId}/name-suggestion - Suggest session name',
      environment: {
        ...commonEnv,
        BEDROCK_MODEL_ID: bedrockModelId,
      },
      timeoutSeconds: 60,
    });
    this.grantCommonPermissions(getSessionNameSuggestionFn, props);
    bedrockComprehend.grantInvoke(getSessionNameSuggestionFn.role);

    // Media URL
    const getMediaUrlFn = this.createLambda('GetMediaUrl', {
      entry: handlersDir,
      description: 'GET /sessions/{sessionId}/media-url - Get CloudFront signed URL',
      environment: { ...commonEnv, ...mediaUrlEnv },
    });
    getMediaUrlFn.grantDynamoDbRead(props.table.tableArn);
    getMediaUrlFn.grantS3Read(props.mediaBucket.bucketArn);
    getMediaUrlFn.grantKmsAccess(props.kmsKey.keyArn);
    // Grant SSM read for CloudFront private key
    if (cfPrivateKeyParam) {
      getMediaUrlFn.role.addToPolicy(
        new cdk.aws_iam.PolicyStatement({
          effect: cdk.aws_iam.Effect.ALLOW,
          actions: ['ssm:GetParameter'],
          resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${cfPrivateKeyParam}`],
        })
      );
    }

    // Consensus
    const getConsensusFn = this.createLambda('GetConsensus', {
      entry: handlersDir,
      description: 'GET /consensus/{sessionId}/segments - Consensus status',
      environment: commonEnv,
    });
    this.grantCommonPermissions(getConsensusFn, props);

    const postConsensusResolveFn = this.createLambda('PostConsensusResolve', {
      entry: handlersDir,
      description: 'POST /consensus/{sessionId}/resolve - Manual conflict resolution',
      environment: commonEnv,
    });
    this.grantCommonPermissions(postConsensusResolveFn, props);
    postConsensusResolveFn.grantEventBridgePutEvents(this.eventBus.eventBusArn);

    // Ranking
    const getRankingFn = this.createLambda('GetRanking', {
      entry: handlersDir,
      description: 'GET /ranking - Contributor ranking',
      environment: commonEnv,
    });
    getRankingFn.grantDynamoDbRead(props.table.tableArn);
    getRankingFn.grantKmsAccess(props.kmsKey.keyArn);

    // Me (current user profile)
    const getMeFn = this.createLambda('GetMe', {
      entry: handlersDir,
      description: 'GET /me - Current user profile',
      environment: commonEnv,
    });
    getMeFn.grantDynamoDbRead(props.table.tableArn);
    getMeFn.grantKmsAccess(props.kmsKey.keyArn);

    // Me (update own profile: displayName/email)
    const patchMeFn = this.createLambda('PatchMe', {
      entry: handlersDir,
      description: 'PATCH /me - Update current user profile (displayName/email)',
      environment: commonEnv,
      fileName: 'update-me',
    });
    this.grantCommonPermissions(patchMeFn, props);
    patchMeFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminUpdateUserAttributes'],
        resources: [props.userPool.userPoolArn],
      })
    );

    // Admin - Users
    const getAdminUsersFn = this.createLambda('GetAdminUsers', {
      entry: handlersDir,
      description: 'GET /admin/users - User list',
      environment: commonEnv,
      fileName: 'admin-users',
      exportedHandler: 'listUsersHandler',
    });
    this.grantCommonPermissions(getAdminUsersFn, props);

    const postAdminUsersFn = this.createLambda('PostAdminUsers', {
      entry: handlersDir,
      description: 'POST /admin/users - Create user',
      environment: commonEnv,
      fileName: 'admin-users',
      exportedHandler: 'createUserHandler',
    });
    this.grantCommonPermissions(postAdminUsersFn, props);
    postAdminUsersFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminUpdateUserAttributes',
        ],
        resources: [props.userPool.userPoolArn],
      })
    );

    const patchAdminUsersFn = this.createLambda('PatchAdminUsers', {
      entry: handlersDir,
      description: 'PATCH /admin/users/{userId} - Update/disable/enable user',
      environment: commonEnv,
      fileName: 'admin-users',
      exportedHandler: 'updateUserHandler',
    });
    this.grantCommonPermissions(patchAdminUsersFn, props);
    patchAdminUsersFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminUserGlobalSignOut',
        ],
        resources: [props.userPool.userPoolArn],
      })
    );

    // Admin - Sync User (register existing Cognito user into app DB)
    const postAdminUsersSyncFn = this.createLambda('PostAdminUsersSync', {
      entry: handlersDir,
      description: 'POST /admin/users/sync - Sync existing Cognito user to DynamoDB',
      environment: commonEnv,
      fileName: 'admin-sync-user',
    });
    this.grantCommonPermissions(postAdminUsersSyncFn, props);
    postAdminUsersSyncFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser'],
        resources: [props.userPool.userPoolArn],
      })
    );

    // Admin - Teams
    const getAdminTeamsFn = this.createLambda('GetAdminTeams', {
      entry: handlersDir,
      description: 'GET /admin/teams - Team list',
      environment: commonEnv,
      fileName: 'admin-teams',
      exportedHandler: 'listTeamsHandler',
    });
    this.grantCommonPermissions(getAdminTeamsFn, props);

    const postAdminTeamsFn = this.createLambda('PostAdminTeams', {
      entry: handlersDir,
      description: 'POST /admin/teams - Create team',
      environment: commonEnv,
      fileName: 'admin-teams',
      exportedHandler: 'createTeamHandler',
    });
    this.grantCommonPermissions(postAdminTeamsFn, props);

    const patchAdminTeamsFn = this.createLambda('PatchAdminTeams', {
      entry: handlersDir,
      description: 'PATCH /admin/teams/{teamId} - Update team',
      environment: commonEnv,
      fileName: 'admin-teams',
      exportedHandler: 'updateTeamHandler',
    });
    this.grantCommonPermissions(patchAdminTeamsFn, props);

    const deleteAdminTeamsFn = this.createLambda('DeleteAdminTeams', {
      entry: handlersDir,
      description: 'DELETE /admin/teams/{teamId} - Delete team',
      environment: commonEnv,
      fileName: 'admin-teams',
      exportedHandler: 'deleteTeamHandler',
    });
    this.grantCommonPermissions(deleteAdminTeamsFn, props);

    // Admin - Team Members
    const getTeamMembersFn = this.createLambda('GetTeamMembers', {
      entry: handlersDir,
      description: 'GET /admin/teams/{teamId}/members - List team members',
      environment: commonEnv,
      fileName: 'admin-teams',
      exportedHandler: 'listTeamMembersHandler',
    });
    this.grantCommonPermissions(getTeamMembersFn, props);

    const postTeamMembersFn = this.createLambda('PostTeamMembers', {
      entry: handlersDir,
      description: 'POST /admin/teams/{teamId}/members - Add team member',
      environment: commonEnv,
      fileName: 'admin-teams',
      exportedHandler: 'addTeamMemberHandler',
    });
    this.grantCommonPermissions(postTeamMembersFn, props);

    const deleteTeamMembersFn = this.createLambda('DeleteTeamMembers', {
      entry: handlersDir,
      description: 'DELETE /admin/teams/{teamId}/members/{userId} - Remove team member',
      environment: commonEnv,
      fileName: 'admin-teams',
      exportedHandler: 'removeTeamMemberHandler',
    });
    this.grantCommonPermissions(deleteTeamMembersFn, props);

    // Admin - Team Assignments
    const postTeamAssignmentsFn = this.createLambda('PostTeamAssignments', {
      entry: handlersDir,
      description: 'POST /admin/teams/{teamId}/assignments - Create team assignment',
      environment: commonEnv,
      fileName: 'team-assignments',
      exportedHandler: 'createTeamAssignmentHandler',
    });
    this.grantCommonPermissions(postTeamAssignmentsFn, props);

    const deleteTeamAssignmentsFn = this.createLambda('DeleteTeamAssignments', {
      entry: handlersDir,
      description: 'DELETE /admin/teams/{teamId}/assignments/{sessionId} - Delete team assignment',
      environment: commonEnv,
      fileName: 'team-assignments',
      exportedHandler: 'deleteTeamAssignmentHandler',
    });
    this.grantCommonPermissions(deleteTeamAssignmentsFn, props);

    const getTeamAssignmentsFn = this.createLambda('GetTeamAssignments', {
      entry: handlersDir,
      description: 'GET /admin/teams/{teamId}/assignments - List team assignments',
      environment: commonEnv,
      fileName: 'team-assignments',
      exportedHandler: 'listTeamAssignmentsHandler',
    });
    this.grantCommonPermissions(getTeamAssignmentsFn, props);

    // Admin - IP Allowlist
    const getIpAllowlistFn = this.createLambda('GetIpAllowlist', {
      entry: handlersDir,
      description: 'GET /admin/ip-allowlist - Get IP allowlist',
      environment: { ...commonEnv, ...wafEnv },
      fileName: 'admin-ip-allowlist',
      exportedHandler: 'listIPAllowlistHandler',
    });
    getIpAllowlistFn.grantDynamoDbRead(props.table.tableArn);
    getIpAllowlistFn.grantKmsAccess(props.kmsKey.keyArn);

    const postIpAllowlistFn = this.createLambda('PostIpAllowlist', {
      entry: handlersDir,
      description: 'POST /admin/ip-allowlist - Add IP allowlist entry',
      environment: { ...commonEnv, ...wafEnv },
      fileName: 'admin-ip-allowlist',
      exportedHandler: 'addIPAllowlistHandler',
    });
    this.grantCommonPermissions(postIpAllowlistFn, props);

    const deleteIpAllowlistFn = this.createLambda('DeleteIpAllowlist', {
      entry: handlersDir,
      description: 'DELETE /admin/ip-allowlist/{entryId} - Delete IP allowlist entry',
      environment: { ...commonEnv, ...wafEnv },
      fileName: 'admin-ip-allowlist',
      exportedHandler: 'deleteIPAllowlistHandler',
    });
    this.grantCommonPermissions(deleteIpAllowlistFn, props);

    // Grant WAFv2 permissions to IP allowlist Lambdas
    const wafIpSetArn = `arn:aws:wafv2:${this.region}:${this.account}:regional/ipset/${wafIpSet.name}/${wafIpSet.attrId}`;
    const wafPolicy = new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'wafv2:GetIPSet',
        'wafv2:UpdateIPSet',
      ],
      resources: [wafIpSetArn],
    });
    getIpAllowlistFn.role.addToPolicy(wafPolicy);
    postIpAllowlistFn.role.addToPolicy(wafPolicy);
    deleteIpAllowlistFn.role.addToPolicy(wafPolicy);

    // Admin - Audit Logs
    const getAuditLogsFn = this.createLambda('GetAuditLogs', {
      entry: handlersDir,
      description: 'GET /admin/audit-logs - Search audit logs',
      environment: commonEnv,
      fileName: 'audit-logs',
      exportedHandler: 'listAuditLogsHandler',
    });
    getAuditLogsFn.grantDynamoDbRead(props.table.tableArn);
    getAuditLogsFn.grantKmsAccess(props.kmsKey.keyArn);

    const deleteAuditLogsFn = this.createLambda('DeleteAuditLogs', {
      entry: handlersDir,
      description: 'DELETE /admin/audit-logs - Delete audit logs',
      environment: commonEnv,
      fileName: 'audit-logs',
      exportedHandler: 'deleteAuditLogsHandler',
    });
    this.grantCommonPermissions(deleteAuditLogsFn, props);

    // --- New Transcription Workflow Lambda Functions ---

    // Upload URL (PresignedURL generation)
    const uploadUrlFn = this.createLambda('UploadUrl', {
      entry: handlersDir,
      description: 'POST /upload-url - Generate S3 PresignedURL for media upload',
      environment: {
        ...commonEnv,
        PRESIGNED_URL_EXPIRY_SECONDS: String(presignedUrlExpirySeconds),
      },
    });
    uploadUrlFn.grantDynamoDbReadWrite(props.table.tableArn);
    uploadUrlFn.grantS3ReadWrite(props.mediaBucket.bucketArn);
    uploadUrlFn.grantKmsAccess(props.kmsKey.keyArn);

    // Get Media Files
    const getMediaFilesFn = this.createLambda('GetMediaFiles', {
      entry: handlersDir,
      description: 'GET /media-files - List media files',
      environment: commonEnv,
    });
    getMediaFilesFn.grantDynamoDbRead(props.table.tableArn);
    getMediaFilesFn.grantKmsAccess(props.kmsKey.keyArn);

    // Start Transcription
    const startTranscriptionFn = this.createLambda('StartTranscription', {
      entry: handlersDir,
      description: 'POST /transcription-jobs - Start Transcribe job',
      environment: {
        ...commonEnv,
        TRANSCRIBE_OUTPUT_BUCKET: props.dataBucket.bucketName,
      },
    });
    startTranscriptionFn.grantDynamoDbReadWrite(props.table.tableArn);
    startTranscriptionFn.grantS3Read(props.mediaBucket.bucketArn);
    startTranscriptionFn.grantS3ReadWrite(props.dataBucket.bucketArn);
    startTranscriptionFn.grantKmsAccess(props.kmsKey.keyArn);
    startTranscriptionFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['transcribe:StartTranscriptionJob'],
        resources: ['*'],
      })
    );

    // Get Job Status
    const getJobStatusFn = this.createLambda('GetJobStatus', {
      entry: handlersDir,
      description: 'GET /transcription-jobs/{jobId} - Get job status',
      environment: commonEnv,
    });
    getJobStatusFn.grantDynamoDbRead(props.table.tableArn);
    getJobStatusFn.grantKmsAccess(props.kmsKey.keyArn);

    // Download Transcription
    const downloadTranscriptionFn = this.createLambda('DownloadTranscription', {
      entry: handlersDir,
      description: 'GET /sessions/{sessionId}/download - Download corrected transcription',
      environment: commonEnv,
    });
    downloadTranscriptionFn.grantDynamoDbRead(props.table.tableArn);
    downloadTranscriptionFn.grantS3Read(props.dataBucket.bucketArn);
    downloadTranscriptionFn.grantKmsAccess(props.kmsKey.keyArn);

    // Create Language Model
    const createLanguageModelFn = this.createLambda('CreateLanguageModel', {
      entry: handlersDir,
      description: 'POST /language-models - Create custom language model',
      environment: { ...commonEnv, ...transcribeEnv },
    });
    createLanguageModelFn.grantDynamoDbReadWrite(props.table.tableArn);
    createLanguageModelFn.grantS3ReadWrite(props.dataBucket.bucketArn);
    createLanguageModelFn.grantKmsAccess(props.kmsKey.keyArn);
    createLanguageModelFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          'transcribe:CreateLanguageModel',
          'transcribe:ListLanguageModels',
        ],
        resources: ['*'],
      })
    );

    // List Language Models
    const listLanguageModelsFn = this.createLambda('ListLanguageModels', {
      entry: handlersDir,
      description: 'GET /language-models - List custom language models',
      environment: { ...commonEnv, ...transcribeEnv },
    });
    listLanguageModelsFn.grantDynamoDbRead(props.table.tableArn);
    listLanguageModelsFn.grantKmsAccess(props.kmsKey.keyArn);
    listLanguageModelsFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['transcribe:ListLanguageModels'],
        resources: ['*'],
      })
    );

    // Get Model Status
    const getModelStatusFn = this.createLambda('GetModelStatus', {
      entry: handlersDir,
      description: 'GET /language-models/{modelName} - Get model status',
      environment: { ...commonEnv, ...transcribeEnv },
    });
    getModelStatusFn.grantDynamoDbRead(props.table.tableArn);
    getModelStatusFn.grantKmsAccess(props.kmsKey.keyArn);
    getModelStatusFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['transcribe:DescribeLanguageModel'],
        resources: ['*'],
      })
    );

    // Delete Media
    const deleteMediaFn = this.createLambda('DeleteMedia', {
      entry: handlersDir,
      description: 'DELETE /media-files/{mediaFileId} - Delete media file',
      environment: commonEnv,
    });
    deleteMediaFn.grantDynamoDbReadWrite(props.table.tableArn);
    deleteMediaFn.grantS3ReadWrite(props.mediaBucket.bucketArn);
    deleteMediaFn.grantKmsAccess(props.kmsKey.keyArn);

    // Delete Transcription
    const deleteTranscriptionFn = this.createLambda('DeleteTranscription', {
      entry: handlersDir,
      description: 'DELETE /sessions/{sessionId}/transcription - Delete transcription',
      environment: commonEnv,
    });
    deleteTranscriptionFn.grantDynamoDbReadWrite(props.table.tableArn);
    deleteTranscriptionFn.grantS3ReadWrite(props.dataBucket.bucketArn);
    deleteTranscriptionFn.grantKmsAccess(props.kmsKey.keyArn);

    // Process Upload (S3 Event triggered)
    const processUploadFn = this.createLambda('ProcessUpload', {
      entry: handlersDir,
      description: 'S3 Event: ObjectCreated → Record media metadata',
      environment: commonEnv,
      timeoutSeconds: 60,
    });
    processUploadFn.grantDynamoDbReadWrite(props.table.tableArn);
    processUploadFn.grantS3Read(props.mediaBucket.bucketArn);
    processUploadFn.grantKmsAccess(props.kmsKey.keyArn);
    processUploadFn.grantEventBridgePutEvents(this.eventBus.eventBusArn);

    // Process Job Complete (EventBridge triggered)
    const processJobCompleteFn = this.createLambda('ProcessJobComplete', {
      entry: handlersDir,
      description: 'EventBridge: Transcribe job completed → Process results',
      environment: commonEnv,
      timeoutSeconds: 120,
    });
    processJobCompleteFn.grantDynamoDbReadWrite(props.table.tableArn);
    processJobCompleteFn.grantS3ReadWrite(props.dataBucket.bucketArn);
    processJobCompleteFn.grantKmsAccess(props.kmsKey.keyArn);
    processJobCompleteFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['transcribe:GetTranscriptionJob'],
        resources: ['*'],
      })
    );

    // --- DLQ for process-upload Lambda ---
    const processUploadDlq = new sqs.Queue(this, 'ProcessUploadDLQ', {
      queueName: 'transcription-review-process-upload-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.kmsKey,
    });

    // Configure DLQ on process-upload Lambda
    const cfnProcessUploadFn = processUploadFn.function.node.defaultChild as cdk.aws_lambda.CfnFunction;
    cfnProcessUploadFn.addPropertyOverride('DeadLetterConfig', {
      TargetArn: processUploadDlq.queueArn,
    });
    processUploadFn.role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [processUploadDlq.queueArn],
      })
    );

    // --- S3 Event Notification: ObjectCreated → process-upload Lambda ---
    // Grant S3 permission to invoke the Lambda
    processUploadFn.function.addPermission('S3InvokePermission', {
      principal: new cdk.aws_iam.ServicePrincipal('s3.amazonaws.com'),
      sourceArn: props.mediaBucket.bucketArn,
      sourceAccount: this.account,
    });

    // Configure S3 bucket notification using CfnCustomResource to avoid cross-stack cyclic dependency
    const notificationRole = new cdk.aws_iam.Role(this, 'S3NotificationRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    notificationRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
        resources: [props.mediaBucket.bucketArn],
      })
    );

    const notificationHandler = new cdk.aws_lambda.Function(this, 'S3NotificationHandler', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      role: notificationRole,
      code: cdk.aws_lambda.Code.fromInline(`
const { S3Client, PutBucketNotificationConfigurationCommand, GetBucketNotificationConfigurationCommand } = require('@aws-sdk/client-s3');
const response = require('cfn-response');
exports.handler = async (event, context) => {
  const s3 = new S3Client({});
  try {
    if (event.RequestType === 'Delete') {
      // Remove the notification configuration on delete
      const current = await s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: event.ResourceProperties.BucketName }));
      const configs = (current.LambdaFunctionConfigurations || []).filter(c => c.LambdaFunctionArn !== event.ResourceProperties.LambdaArn);
      await s3.send(new PutBucketNotificationConfigurationCommand({
        Bucket: event.ResourceProperties.BucketName,
        NotificationConfiguration: {
          ...current,
          LambdaFunctionConfigurations: configs,
        },
      }));
      await response.send(event, context, response.SUCCESS);
      return;
    }
    const current = await s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: event.ResourceProperties.BucketName }));
    const existing = current.LambdaFunctionConfigurations || [];
    const alreadyExists = existing.some(c => c.LambdaFunctionArn === event.ResourceProperties.LambdaArn);
    if (!alreadyExists) {
      existing.push({
        LambdaFunctionArn: event.ResourceProperties.LambdaArn,
        Events: ['s3:ObjectCreated:*'],
        Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'media/' }] } },
      });
    }
    await s3.send(new PutBucketNotificationConfigurationCommand({
      Bucket: event.ResourceProperties.BucketName,
      NotificationConfiguration: {
        ...current,
        LambdaFunctionConfigurations: existing,
      },
    }));
    await response.send(event, context, response.SUCCESS);
  } catch (e) {
    console.error(e);
    await response.send(event, context, response.FAILED);
  }
};
      `),
      timeout: cdk.Duration.seconds(60),
    });

    new cdk.CustomResource(this, 'S3MediaBucketNotification', {
      serviceToken: notificationHandler.functionArn,
      properties: {
        BucketName: props.mediaBucket.bucketName,
        LambdaArn: processUploadFn.function.functionArn,
      },
    });

    // --- EventBridge Rule: Transcribe job completion (default bus) ---
    new events.Rule(this, 'TranscribeJobCompletedRule', {
      ruleName: 'TranscribeJobCompleted-ProcessJobComplete',
      description: 'Triggers process-job-complete when Transcribe job status changes to COMPLETED or FAILED',
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Job State Change'],
        detail: {
          TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
        },
      },
      targets: [new eventsTargets.LambdaFunction(processJobCompleteFn.function)],
    });

    // --- Async Processing Lambda Functions ---

    // Consensus aggregation Lambda (triggered by EventBridge)
    const consensusLambda = this.createLambda('ConsensusAggregation', {
      entry: handlersDir,
      description: 'EventBridge: CorrectionConfirmed → Consensus aggregation',
      environment: {
        ...commonEnv,
        MIN_REVIEWERS_FOR_AUTO_CONSENSUS: String(minReviewers),
      },
      timeoutSeconds: 60,
    });
    this.grantCommonPermissions(consensusLambda, props);
    consensusLambda.grantEventBridgePutEvents(this.eventBus.eventBusArn);

    // Score update Lambda (triggered by EventBridge)
    const scoreLambda = this.createLambda('ScoreUpdate', {
      entry: handlersDir,
      description: 'EventBridge: ConsensusResultConfirmed → Score update',
      environment: commonEnv,
      timeoutSeconds: 60,
    });
    this.grantCommonPermissions(scoreLambda, props);

    // --- EventBridge Rules ---

    // CorrectionConfirmed → Consensus aggregation Lambda
    new events.Rule(this, 'CorrectionConfirmedRule', {
      ruleName: 'CorrectionConfirmed-ConsensusAggregation',
      description: 'Triggers consensus aggregation when all reviewers confirm corrections',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['transcription-review-app'],
        detailType: ['CorrectionConfirmed'],
      },
      targets: [new eventsTargets.LambdaFunction(consensusLambda.function)],
    });

    // ConsensusResultConfirmed → Score update Lambda
    new events.Rule(this, 'ConsensusResultConfirmedRule', {
      ruleName: 'ConsensusResultConfirmed-ScoreUpdate',
      description: 'Triggers score update when consensus result is confirmed',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['transcription-review-app'],
        detailType: ['ConsensusResultConfirmed'],
      },
      targets: [new eventsTargets.LambdaFunction(scoreLambda.function)],
    });

    // --- Malware Scan Construct ---
    const malwareScan = new MalwareScan(this, 'MalwareScan', {
      mediaBucket: props.mediaBucket,
      kmsKey: props.kmsKey,
      tableArn: props.table.tableArn,
      tableName: props.table.tableName,
    });

    // S3 ObjectCreated EventBridge rule → Malware Scan Lambda
    // Note: S3 events go to the default event bus when S3 Event Notifications to EventBridge is enabled
    new events.Rule(this, 'S3ObjectCreatedMalwareScanRule', {
      ruleName: 'S3ObjectCreated-MalwareScan',
      description: 'Triggers malware scan when a new object is created in the media bucket',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['transcription-review-app'],
        detailType: ['S3ObjectCreated'],
      },
      targets: [new eventsTargets.LambdaFunction(malwareScan.scanFunction)],
    });

    // --- S3 Bucket Policy: Deny GetObject for PENDING scanStatus objects except from malware scan Lambda ---
    // Use CfnBucketPolicy in ApiStack to avoid cross-stack cyclic dependency
    new s3.CfnBucketPolicy(this, 'MediaBucketScanPolicy', {
      bucket: props.mediaBucket.bucketName,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'DenyGetObjectForPendingScanStatus',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `${props.mediaBucket.bucketArn}/media/*`,
            Condition: {
              StringEquals: {
                's3:ExistingObjectTag/scanStatus': 'PENDING',
              },
              StringNotEquals: {
                'aws:PrincipalArn': malwareScan.scanRole.roleArn,
              },
            },
          },
          {
            Sid: 'EnforceSSLOnly',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [
              props.mediaBucket.bucketArn,
              `${props.mediaBucket.bucketArn}/*`,
            ],
            Condition: {
              Bool: {
                'aws:SecureTransport': 'false',
              },
            },
          },
        ],
      },
    });

    // --- Admin Settings Lambda Functions ---

    // Admin - Ranking Settings
    const getRankingSettingsFn = this.createLambda('GetRankingSettings', {
      entry: handlersDir,
      description: 'GET /admin/settings/ranking - Get ranking display settings',
      environment: commonEnv,
      fileName: 'admin-ranking-settings',
      exportedHandler: 'getHandler',
    });
    getRankingSettingsFn.grantDynamoDbRead(props.table.tableArn);
    getRankingSettingsFn.grantKmsAccess(props.kmsKey.keyArn);

    const patchRankingSettingsFn = this.createLambda('PatchRankingSettings', {
      entry: handlersDir,
      description: 'PATCH /admin/settings/ranking - Update ranking display settings',
      environment: commonEnv,
      fileName: 'admin-ranking-settings',
      exportedHandler: 'patchHandler',
    });
    this.grantCommonPermissions(patchRankingSettingsFn, props);

    // Admin - Consensus Settings
    const patchConsensusSettingsFn = this.createLambda('PatchConsensusSettings', {
      entry: handlersDir,
      description: 'PATCH /admin/settings/consensus - Update consensus settings',
      environment: commonEnv,
      fileName: 'admin-consensus-settings',
    });
    this.grantCommonPermissions(patchConsensusSettingsFn, props);

    // --- API Gateway HTTP API with JWT Authorizer ---
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'TranscriptionReviewApi',
      description: 'Transcription Review App HTTP API',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // JWT Authorizer (Cognito User Pool)
    const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      }
    );

    // --- Route Definitions ---

    // Sessions
    this.addRoute('GET', '/sessions', getSessionsFn, jwtAuthorizer);
    // Register the static /sessions/assigned route before the greedy
    // /sessions/{sessionId} so it is matched by its own handler.
    this.addRoute('GET', '/sessions/assigned', getAssignedSessionsFn, jwtAuthorizer);
    // Static /sessions/joinable is also registered before the greedy
    // /sessions/{sessionId} so it is matched by its own handler.
    this.addRoute('GET', '/sessions/joinable', getJoinableSessionsFn, jwtAuthorizer);
    this.addRoute('GET', '/sessions/{sessionId}', getSessionDetailFn, jwtAuthorizer);
    this.addRoute('PATCH', '/sessions/{sessionId}/status', patchSessionStatusFn, jwtAuthorizer);
    this.addRoute('PATCH', '/sessions/{sessionId}/name', patchSessionNameFn, jwtAuthorizer);
    this.addRoute('PATCH', '/sessions/{sessionId}/assignment', patchSessionAssignmentFn, jwtAuthorizer);
    this.addRoute('POST', '/sessions/{sessionId}/join', postSessionJoinFn, jwtAuthorizer);
    this.addRoute('POST', '/sessions/{sessionId}/self-assign', postSessionSelfAssignFn, jwtAuthorizer);
    this.addRoute('POST', '/sessions/{sessionId}/aggregate', postSessionAggregateFn, jwtAuthorizer);
    this.addRoute('POST', '/sessions/{sessionId}/reopen', postSessionReopenFn, jwtAuthorizer);
    this.addRoute('GET', '/sessions/{sessionId}/segments', getSegmentsFn, jwtAuthorizer);
    this.addRoute('POST', '/sessions/{sessionId}/speaker-labels', postSpeakerLabelFn, jwtAuthorizer);
    this.addRoute('DELETE', '/sessions/{sessionId}/speaker-labels/{label}', deleteSpeakerLabelFn, jwtAuthorizer);

    // Corrections
    this.addRoute('POST', '/sessions/{sessionId}/corrections', postCorrectionsFn, jwtAuthorizer);
    this.addRoute('GET', '/sessions/{sessionId}/corrections', getCorrectionsFn, jwtAuthorizer);

    // Suggestions
    this.addRoute('GET', '/sessions/{sessionId}/suggestions', getSuggestionsFn, jwtAuthorizer);
    this.addRoute('GET', '/sessions/{sessionId}/name-suggestion', getSessionNameSuggestionFn, jwtAuthorizer);

    // Media URL
    this.addRoute('GET', '/sessions/{sessionId}/media-url', getMediaUrlFn, jwtAuthorizer);

    // Consensus
    this.addRoute('GET', '/consensus/{sessionId}/segments', getConsensusFn, jwtAuthorizer);
    this.addRoute('POST', '/consensus/{sessionId}/resolve', postConsensusResolveFn, jwtAuthorizer);

    // Ranking
    this.addRoute('GET', '/ranking', getRankingFn, jwtAuthorizer);

    // Me (current user profile)
    this.addRoute('GET', '/me', getMeFn, jwtAuthorizer);
    this.addRoute('PATCH', '/me', patchMeFn, jwtAuthorizer);

    // Admin - Users
    this.addRoute('GET', '/admin/users', getAdminUsersFn, jwtAuthorizer);
    this.addRoute('POST', '/admin/users', postAdminUsersFn, jwtAuthorizer);
    this.addRoute('POST', '/admin/users/sync', postAdminUsersSyncFn, jwtAuthorizer);
    this.addRoute('PATCH', '/admin/users/{userId}', patchAdminUsersFn, jwtAuthorizer);

    // Admin - Teams
    this.addRoute('GET', '/admin/teams', getAdminTeamsFn, jwtAuthorizer);
    this.addRoute('POST', '/admin/teams', postAdminTeamsFn, jwtAuthorizer);
    this.addRoute('PATCH', '/admin/teams/{teamId}', patchAdminTeamsFn, jwtAuthorizer);
    this.addRoute('DELETE', '/admin/teams/{teamId}', deleteAdminTeamsFn, jwtAuthorizer);
    this.addRoute('GET', '/admin/teams/{teamId}/members', getTeamMembersFn, jwtAuthorizer);
    this.addRoute('POST', '/admin/teams/{teamId}/members', postTeamMembersFn, jwtAuthorizer);
    this.addRoute('DELETE', '/admin/teams/{teamId}/members/{userId}', deleteTeamMembersFn, jwtAuthorizer);
    this.addRoute('GET', '/admin/teams/{teamId}/assignments', getTeamAssignmentsFn, jwtAuthorizer);
    this.addRoute('POST', '/admin/teams/{teamId}/assignments', postTeamAssignmentsFn, jwtAuthorizer);
    this.addRoute('DELETE', '/admin/teams/{teamId}/assignments/{sessionId}', deleteTeamAssignmentsFn, jwtAuthorizer);

    // Admin - IP Allowlist
    this.addRoute('GET', '/admin/ip-allowlist', getIpAllowlistFn, jwtAuthorizer);
    this.addRoute('POST', '/admin/ip-allowlist', postIpAllowlistFn, jwtAuthorizer);
    this.addRoute('DELETE', '/admin/ip-allowlist/{entryId}', deleteIpAllowlistFn, jwtAuthorizer);

    // Admin - Audit Logs
    this.addRoute('GET', '/admin/audit-logs', getAuditLogsFn, jwtAuthorizer);
    this.addRoute('DELETE', '/admin/audit-logs', deleteAuditLogsFn, jwtAuthorizer);

    // Admin - Settings
    this.addRoute('GET', '/admin/settings/ranking', getRankingSettingsFn, jwtAuthorizer);
    this.addRoute('PATCH', '/admin/settings/ranking', patchRankingSettingsFn, jwtAuthorizer);
    this.addRoute('PATCH', '/admin/settings/consensus', patchConsensusSettingsFn, jwtAuthorizer);

    // Media Upload
    this.addRoute('POST', '/upload-url', uploadUrlFn, jwtAuthorizer);
    this.addRoute('GET', '/media-files', getMediaFilesFn, jwtAuthorizer);
    this.addRoute('DELETE', '/media-files/{mediaFileId}', deleteMediaFn, jwtAuthorizer);

    // Transcription Jobs
    this.addRoute('POST', '/transcription-jobs', startTranscriptionFn, jwtAuthorizer);
    this.addRoute('GET', '/transcription-jobs/{jobId}', getJobStatusFn, jwtAuthorizer);

    // Download
    this.addRoute('GET', '/sessions/{sessionId}/download', downloadTranscriptionFn, jwtAuthorizer);

    // Transcription Deletion
    this.addRoute('DELETE', '/sessions/{sessionId}/transcription', deleteTranscriptionFn, jwtAuthorizer);

    // Language Models
    this.addRoute('GET', '/language-models', listLanguageModelsFn, jwtAuthorizer);
    this.addRoute('POST', '/language-models', createLanguageModelFn, jwtAuthorizer);
    this.addRoute('GET', '/language-models/{modelName}', getModelStatusFn, jwtAuthorizer);

    // --- CloudFormation Outputs ---
    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-HttpApiUrl`,
    });

    new cdk.CfnOutput(this, 'HttpApiId', {
      value: this.httpApi.httpApiId,
      exportName: `${id}-HttpApiId`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      exportName: `${id}-EventBusName`,
    });

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      exportName: `${id}-EventBusArn`,
    });
  }

  /**
   * Create a Lambda function using the shared construct
   */
  private createLambda(
    name: string,
    options: {
      entry: string;
      description: string;
      environment: Record<string, string>;
      timeoutSeconds?: number;
      /** Override handler file name (without .ts extension). Defaults to kebab-case of name. */
      fileName?: string;
      /** Override exported function name. Defaults to 'handler'. */
      exportedHandler?: string;
    }
  ): LambdaFunction {
    const kebabName = this.toPascalToKebab(name);
    const fileName = options.fileName ?? kebabName;
    return new LambdaFunction(this, `${name}Lambda`, {
      functionName: `transcription-review-${kebabName}`,
      entry: `${options.entry}/${fileName}.ts`,
      handler: options.exportedHandler ?? 'handler',
      description: options.description,
      environment: options.environment,
      timeoutSeconds: options.timeoutSeconds,
    });
  }

  /**
   * Grant common permissions (DynamoDB read/write + KMS) to a Lambda function
   */
  private grantCommonPermissions(fn: LambdaFunction, props: ApiStackProps): void {
    fn.grantDynamoDbReadWrite(props.table.tableArn);
    fn.grantKmsAccess(props.kmsKey.keyArn);
  }

  /**
   * Add an HTTP API route with Lambda integration and JWT authorizer
   */
  private addRoute(
    method: string,
    path: string,
    lambdaFn: LambdaFunction,
    authorizer: apigatewayv2Authorizers.HttpJwtAuthorizer
  ): void {
    const httpMethod = this.toHttpMethod(method);
    this.httpApi.addRoutes({
      path,
      methods: [httpMethod],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        `${method}${path.replace(/[/{}-]/g, '')}Integration`,
        lambdaFn.function
      ),
      authorizer,
    });
  }

  /**
   * Convert HTTP method string to CorsHttpMethod enum
   */
  private toHttpMethod(method: string): apigatewayv2.HttpMethod {
    switch (method.toUpperCase()) {
      case 'GET': return apigatewayv2.HttpMethod.GET;
      case 'POST': return apigatewayv2.HttpMethod.POST;
      case 'PATCH': return apigatewayv2.HttpMethod.PATCH;
      case 'DELETE': return apigatewayv2.HttpMethod.DELETE;
      case 'PUT': return apigatewayv2.HttpMethod.PUT;
      default: return apigatewayv2.HttpMethod.GET;
    }
  }

  /**
   * Convert PascalCase to kebab-case
   */
  private toPascalToKebab(str: string): string {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }
}
