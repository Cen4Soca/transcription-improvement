import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class FoundationStack extends cdk.Stack {
  public readonly kmsKey: kms.Key;
  public readonly table: dynamodb.Table;
  public readonly mediaBucket: s3.Bucket;
  public readonly dataBucket: s3.Bucket;
  public readonly staticBucket: s3.Bucket;
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const kmsKeyAdminArns = this.node.tryGetContext('kmsKeyAdminArns') as string[] || [];
    const cognitoUserPoolId = this.node.tryGetContext('cognitoUserPoolId') as string || '';
    const cognitoUserPoolClientId = this.node.tryGetContext('cognitoUserPoolClientId') as string || '';
    const cognitoDomain = this.node.tryGetContext('cognitoDomain') as string || '';
    const cloudFrontDistributionId = this.node.tryGetContext('cloudFrontDistributionId') as string || '';
    const envName = this.node.tryGetContext('env') as string || 'dev';
    const initialAdminEmail = this.node.tryGetContext('initialAdminEmail') as string || '';
    // ブラウザから S3 へプリサインドURLで直接アップロードするために許可するオリジン
    // 例: https://xxxxx.cloudfront.net,http://localhost:5173
    const allowedUploadOriginsRaw = this.node.tryGetContext('allowedUploadOrigins') as string || '';
    const allowedUploadOrigins = allowedUploadOriginsRaw
      ? allowedUploadOriginsRaw.split(',').map((o) => o.trim()).filter(Boolean)
      : ['*'];

    // RemovalPolicy: DESTROY for dev/staging (allows clean teardown), RETAIN for prod
    const isProd = envName === 'prod';
    const dataRemovalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Media Glacier transition schedule (days from object creation).
    // GIR at N days; Deep Archive at N + 90 (satisfies GIR's 90-day minimum storage duration).
    // N is configurable via cdk.json context; falls back to 14 if unset/invalid; guarded >= 1.
    const mediaGlacierTransitionDaysRaw = this.node.tryGetContext('mediaGlacierTransitionDays');
    const parsedGlacierDays = Number(mediaGlacierTransitionDaysRaw);
    const mediaGirTransitionDays =
      Number.isInteger(parsedGlacierDays) && parsedGlacierDays >= 1 ? parsedGlacierDays : 14;
    const mediaDeepArchiveTransitionDays = mediaGirTransitionDays + 90;

    // DataBucket transcription-output expiration (days from object creation).
    // Deletes transcriptions/{jobId}/output.json M days after creation.
    // M is configurable via cdk.json context; falls back to 30 if unset/invalid; guarded >= 1.
    const dataTranscriptionExpirationDaysRaw = this.node.tryGetContext('dataTranscriptionExpirationDays');
    const parsedExpirationDays = Number(dataTranscriptionExpirationDaysRaw);
    const dataTranscriptionExpirationDays =
      Number.isInteger(parsedExpirationDays) && parsedExpirationDays >= 1 ? parsedExpirationDays : 30;

    // KMS カスタマーマネージドキー（CMK）
    // pendingWindow: 30 days waiting period before key deletion (Req 22.2)
    this.kmsKey = new kms.Key(this, 'AppKey', {
      alias: 'transcription-review-app',
      description: 'CMK for Transcription Review App (DynamoDB, S3 encryption)',
      enableKeyRotation: true,
      removalPolicy: dataRemovalPolicy,
      pendingWindow: cdk.Duration.days(30),
      policy: this.buildKmsKeyPolicy(kmsKeyAdminArns, cloudFrontDistributionId),
    });

    // DynamoDB シングルテーブル（TranscriptionReviewApp）- オンデマンドキャパシティ
    this.table = new dynamodb.Table(this, 'TranscriptionReviewApp', {
      tableName: 'TranscriptionReviewApp',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      removalPolicy: dataRemovalPolicy,
    });

    // GSI1
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3 — ADMIN 全件一覧用（固定パーティション 'LANGUAGEMODEL'）
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // S3 バケット（メディア用）- KMS 暗号化 + BlockPublicAccess 全項目有効
    // Bucket emptying on teardown is delegated to destroy.sh (proposal 4, option b),
    // not autoDeleteObjects, to avoid the Custom::S3AutoDeleteObjects GetBucketTagging AccessDenied.
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: `transcription-review-media-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: dataRemovalPolicy,
      // ブラウザからプリサインドURLで直接 PUT アップロードするための CORS 設定
      // これがないとブラウザが CORS でリクエストをブロックし、フロントで
      // 「ネットワークエラーが発生しました。」が表示される
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: allowedUploadOrigins,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'media-glacier-transitions',
          prefix: 'media/',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(mediaGirTransitionDays),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(mediaDeepArchiveTransitionDays),
            },
          ],
        },
        {
          id: 'abort-incomplete-multipart-upload',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // S3 バケット（データ用）- KMS 暗号化 + BlockPublicAccess 全項目有効
    // Bucket emptying on teardown is delegated to destroy.sh (proposal 4, option b),
    // not autoDeleteObjects, to avoid the Custom::S3AutoDeleteObjects GetBucketTagging AccessDenied.
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `transcription-review-data-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: dataRemovalPolicy,
      lifecycleRules: [
        {
          id: 'abort-incomplete-multipart-upload',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: 'transcriptions-expiration',
          prefix: 'transcriptions/',
          expiration: cdk.Duration.days(dataTranscriptionExpirationDays),
        },
      ],
    });

    // S3 バケット（静的ファイル用）- KMS 暗号化 + BlockPublicAccess 全項目有効
    // Bucket emptying on teardown is delegated to destroy.sh (proposal 4, option b),
    // not autoDeleteObjects, to avoid the Custom::S3AutoDeleteObjects GetBucketTagging AccessDenied.
    this.staticBucket = new s3.Bucket(this, 'StaticBucket', {
      bucketName: `transcription-review-static-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: dataRemovalPolicy,
      lifecycleRules: [
        {
          id: 'abort-incomplete-multipart-upload',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // Cognito User Pool: import existing or create new
    if (cognitoUserPoolId) {
      // Import existing User Pool (Req 15.1)
      this.userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', cognitoUserPoolId);

      // User Pool Client: import existing (shared User Pool scenario)
      // OAuth settings are managed externally; CDK only registers callback URLs via Custom Resource
      if (cognitoUserPoolClientId) {
        this.userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
          this, 'AppClient', cognitoUserPoolClientId,
        );
      } else {
        // Create a new client on the existing (shared) User Pool with OAuth/Hosted UI support
        // Note: Cannot use L2 addClient on imported pool; use CfnUserPoolClient directly
        const cfnClient = new cognito.CfnUserPoolClient(this, 'AppClient', {
          userPoolId: cognitoUserPoolId,
          clientName: 'TranscriptionReviewAppClient',
          generateSecret: false,
          explicitAuthFlows: [
            'ALLOW_USER_SRP_AUTH',
            'ALLOW_REFRESH_TOKEN_AUTH',
          ],
          allowedOAuthFlows: ['code'],
          allowedOAuthFlowsUserPoolClient: true,
          allowedOAuthScopes: ['openid', 'email', 'profile'],
          supportedIdentityProviders: ['COGNITO'],
          // Callback URLs will be registered by CDN Stack Custom Resource after distribution is created
          // Provide a placeholder to satisfy Cognito validation (OAuth requires at least one callback URL)
          callbackUrLs: ['https://localhost/'],
          logoutUrLs: ['https://localhost/'],
          preventUserExistenceErrors: 'ENABLED',
        });

        this.userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
          this, 'AppClientRef', cfnClient.ref,
        );
      }
    } else {
      // Create new User Pool (Req 15.2)
      const createdUserPool = new cognito.UserPool(this, 'UserPool', {
        userPoolName: 'TranscriptionReviewAppUserPool',
        selfSignUpEnabled: false,
        signInAliases: { email: true },
        autoVerify: { email: true },
        standardAttributes: {
          email: { required: true, mutable: false },
        },
        customAttributes: {
          // custom:role - Mutable: false (Req 14.18 - ユーザー自身による変更を禁止)
          role: new cognito.StringAttribute({ mutable: false }),
          displayName: new cognito.StringAttribute({ mutable: true }),
        },
        passwordPolicy: {
          minLength: 8,
          requireLowercase: true,
          requireUppercase: true,
          requireDigits: true,
          requireSymbols: true,
        },
        accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
        // MFA 設定 (Req 9.12) - OPTIONAL モード（Admin は必須をアプリレベルで強制）
        mfa: cognito.Mfa.OPTIONAL,
        mfaSecondFactor: {
          sms: false,
          otp: true, // TOTP 推奨
        },
        // Advanced Security Features (Req 14.23) - 適応型認証 ENFORCED モード
        advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
        // Cognito: RETAIN when imported (cognitoUserPoolId specified), otherwise env-based
        removalPolicy: dataRemovalPolicy,
      });
      this.userPool = createdUserPool;

      // Add Cognito Hosted UI domain (prefix-based)
      // cognitoDomain context allows specifying a custom domain prefix
      if (cognitoDomain) {
        createdUserPool.addDomain('HostedUIDomain', {
          cognitoDomain: { domainPrefix: cognitoDomain },
        });
      } else {
        // Generate a domain prefix from env + account if not specified
        const domainPrefix = `transcription-review-${envName}`;
        createdUserPool.addDomain('HostedUIDomain', {
          cognitoDomain: { domainPrefix },
        });
      }

      // Create new User Pool Client with OAuth/Hosted UI support
      // WriteAttributes から custom:role を除外 (Req 14.18)
      this.userPoolClient = createdUserPool.addClient('AppClient', {
        userPoolClientName: 'TranscriptionReviewAppClient',
        authFlows: {
          userSrp: true,
        },
        generateSecret: false,
        oAuth: {
          flows: { authorizationCodeGrant: true },
          scopes: [
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.PROFILE,
          ],
          // Placeholder callback URLs; real ones are registered by CDN Stack Custom Resource
          callbackUrls: ['https://localhost/'],
          logoutUrls: ['https://localhost/'],
        },
        supportedIdentityProviders: [
          cognito.UserPoolClientIdentityProvider.COGNITO,
        ],
        readAttributes: new cognito.ClientAttributes()
          .withStandardAttributes({ email: true })
          .withCustomAttributes('role', 'displayName'),
        // custom:role を除外 - Admin API 経由でのみ変更可能
        writeAttributes: new cognito.ClientAttributes()
          .withCustomAttributes('displayName'),
        preventUserExistenceErrors: true,
      });
    }

    // --- Initial Admin User Seed (Custom Resource) ---
    if (initialAdminEmail) {
      const seedAdminRole = new iam.Role(this, 'SeedAdminRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
      seedAdminRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
          resources: [this.table.tableArn, `${this.table.tableArn}/index/*`],
        })
      );
      seedAdminRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey*'],
          resources: [this.kmsKey.keyArn],
        })
      );
      seedAdminRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminGetUser'],
          resources: [this.userPool.userPoolArn],
        })
      );

      const seedAdminHandler = new cdk.aws_lambda.Function(this, 'SeedAdminHandler', {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        role: seedAdminRole,
        timeout: cdk.Duration.seconds(30),
        code: cdk.aws_lambda.Code.fromInline(`
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const crypto = require('crypto');
const response = require('cfn-response');

exports.handler = async (event, context) => {
  if (event.RequestType === 'Delete' || event.RequestType === 'Update') {
    await response.send(event, context, response.SUCCESS);
    return;
  }

  const { TableName, UserPoolId, AdminEmail, Region } = event.ResourceProperties;

  try {
    const dynamoClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: Region }),
      { marshallOptions: { removeUndefinedValues: true } }
    );
    const cognitoClient = new CognitoIdentityProviderClient({ region: Region });

    // Check if user already exists in DynamoDB
    const existing = await dynamoClient.send(new QueryCommand({
      TableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'EMAIL#' + AdminEmail, ':prefix': 'USER#' },
      Limit: 1,
    }));

    if (existing.Items && existing.Items.length > 0) {
      console.log('Admin user already exists in DynamoDB, skipping.');
      await response.send(event, context, response.SUCCESS);
      return;
    }

    // Check if user exists in Cognito, create if not
    let cognitoExists = false;
    try {
      await cognitoClient.send(new AdminGetUserCommand({ UserPoolId, Username: AdminEmail }));
      cognitoExists = true;
    } catch (err) {
      if (err.name !== 'UserNotFoundException') throw err;
    }

    if (!cognitoExists) {
      await cognitoClient.send(new AdminCreateUserCommand({
        UserPoolId,
        Username: AdminEmail,
        UserAttributes: [
          { Name: 'email', Value: AdminEmail },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:role', Value: 'ADMIN' },
          { Name: 'custom:displayName', Value: 'Initial Admin' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }));
    }

    // Create user in DynamoDB
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    await dynamoClient.send(new PutCommand({
      TableName,
      Item: {
        PK: 'USER#' + userId,
        SK: 'METADATA',
        GSI1PK: 'EMAIL#' + AdminEmail,
        GSI1SK: 'USER#' + userId,
        entityType: 'User',
        userId,
        email: AdminEmail,
        displayName: 'Initial Admin',
        role: 'ADMIN',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));

    console.log('Initial admin user created:', AdminEmail);
    await response.send(event, context, response.SUCCESS);
  } catch (err) {
    console.error('Failed to seed admin user:', err);
    await response.send(event, context, response.FAILED);
  }
};
        `),
      });

      new cdk.CustomResource(this, 'SeedAdminUser', {
        serviceToken: seedAdminHandler.functionArn,
        properties: {
          TableName: this.table.tableName,
          UserPoolId: this.userPool.userPoolId,
          AdminEmail: initialAdminEmail,
          Region: this.region,
        },
      });
    }

    // --- Cognito Callback URL Registration ---
    // Moved to CdnStack where the CloudFront Distribution ID is available
    // (both for imported and newly-created distributions)

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: this.kmsKey.keyArn,
      exportName: `${id}-KmsKeyArn`,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      exportName: `${id}-TableName`,
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      exportName: `${id}-TableArn`,
    });

    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: this.mediaBucket.bucketName,
      exportName: `${id}-MediaBucketName`,
    });

    new cdk.CfnOutput(this, 'MediaBucketArn', {
      value: this.mediaBucket.bucketArn,
      exportName: `${id}-MediaBucketArn`,
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: this.dataBucket.bucketName,
      exportName: `${id}-DataBucketName`,
    });

    new cdk.CfnOutput(this, 'DataBucketArn', {
      value: this.dataBucket.bucketArn,
      exportName: `${id}-DataBucketArn`,
    });

    new cdk.CfnOutput(this, 'StaticBucketName', {
      value: this.staticBucket.bucketName,
      exportName: `${id}-StaticBucketName`,
    });

    new cdk.CfnOutput(this, 'StaticBucketArn', {
      value: this.staticBucket.bucketArn,
      exportName: `${id}-StaticBucketArn`,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${id}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${id}-UserPoolClientId`,
    });
  }

  private buildKmsKeyPolicy(adminArns: string[], cloudFrontDistributionId: string): iam.PolicyDocument {
    const statements: iam.PolicyStatement[] = [];

    // Allow account root full access (required for KMS key management)
    statements.push(
      new iam.PolicyStatement({
        sid: 'AllowRootAccountAccess',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountRootPrincipal()],
        actions: ['kms:*'],
        resources: ['*'],
      })
    );

    // Allow specified admin ARNs to administer the key
    if (adminArns.length > 0) {
      statements.push(
        new iam.PolicyStatement({
          sid: 'AllowKeyAdministration',
          effect: iam.Effect.ALLOW,
          principals: adminArns.map((arn) => new iam.ArnPrincipal(arn)),
          actions: [
            'kms:Create*',
            'kms:Describe*',
            'kms:Enable*',
            'kms:List*',
            'kms:Put*',
            'kms:Update*',
            'kms:Revoke*',
            'kms:Disable*',
            'kms:Get*',
            'kms:Delete*',
            'kms:TagResource',
            'kms:UntagResource',
            'kms:ScheduleKeyDeletion',
            'kms:CancelKeyDeletion',
          ],
          resources: ['*'],
        })
      );
    }

    // Allow CloudFront OAC to decrypt KMS-encrypted S3 objects
    if (cloudFrontDistributionId) {
      statements.push(
        new iam.PolicyStatement({
          sid: 'AllowCloudFrontDecrypt',
          effect: iam.Effect.ALLOW,
          principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
          actions: [
            'kms:Decrypt',
            'kms:GenerateDataKey*',
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${cloudFrontDistributionId}`,
            },
          },
        })
      );
    }

    return new iam.PolicyDocument({ statements });
  }
}
