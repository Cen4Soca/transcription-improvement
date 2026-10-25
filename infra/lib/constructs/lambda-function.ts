import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface LambdaFunctionProps {
  /** Lambda function name */
  functionName: string;
  /** Path to the Lambda handler TypeScript source file */
  entry: string;
  /** Exported handler function name (default: handler) */
  handler?: string;
  /** Environment variables */
  environment?: Record<string, string>;
  /** Timeout in seconds (default: 30) */
  timeoutSeconds?: number;
  /** Memory size in MB (default: 256) */
  memorySize?: number;
  /** Description of the Lambda function */
  description?: string;
}

/**
 * Shared Lambda Construct with least-privilege IAM role.
 * Uses NodejsFunction for automatic TypeScript bundling with esbuild.
 * Each Lambda function gets its own IAM role with only the permissions it needs.
 */
export class LambdaFunction extends Construct {
  public readonly function: lambda.Function;
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: LambdaFunctionProps) {
    super(scope, id);

    // Individual IAM role with least-privilege
    this.role = new iam.Role(this, 'Role', {
      roleName: `${props.functionName}-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `Execution role for ${props.functionName}`,
    });

    // Basic Lambda execution permissions (CloudWatch Logs only)
    this.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Lambda function using NodejsFunction for TypeScript bundling
    // In test environments (SKIP_BUNDLING=true), use inline code to avoid esbuild dependency
    const skipBundling = process.env.SKIP_BUNDLING === 'true';

    if (skipBundling) {
      this.function = new lambda.Function(this, 'Function', {
        functionName: props.functionName,
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: `index.${props.handler ?? 'handler'}`,
        code: lambda.Code.fromInline('exports.handler = async () => ({statusCode:200})'),
        role: this.role,
        timeout: cdk.Duration.seconds(props.timeoutSeconds ?? 30),
        memorySize: props.memorySize ?? 256,
        environment: props.environment,
        description: props.description,
        tracing: lambda.Tracing.ACTIVE,
      });
    } else {
      this.function = new lambdaNodejs.NodejsFunction(this, 'Function', {
        functionName: props.functionName,
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: props.entry,
        handler: props.handler ?? 'handler',
        role: this.role,
        timeout: cdk.Duration.seconds(props.timeoutSeconds ?? 30),
        memorySize: props.memorySize ?? 256,
        environment: props.environment,
        description: props.description,
        tracing: lambda.Tracing.ACTIVE,
        depsLockFilePath: '../backend/package-lock.json',
        bundling: {
          format: lambdaNodejs.OutputFormat.ESM,
          mainFields: ['module', 'main'],
          // AWS SDK v3 is available in Lambda runtime; no need to bundle
          externalModules: ['@aws-sdk/*'],
          sourceMap: true,
          minify: false,
          target: 'node24',
          // Workaround for ESM: add banner to support require() if needed
          banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        },
      });
    }

    // CloudWatch Logs group with retention
    new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${props.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  /**
   * Grant DynamoDB read/write access to the function's role
   */
  public grantDynamoDbReadWrite(tableArn: string): void {
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
        ],
        resources: [tableArn, `${tableArn}/index/*`],
      })
    );
  }

  /**
   * Grant DynamoDB read-only access to the function's role
   */
  public grantDynamoDbRead(tableArn: string): void {
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
        ],
        resources: [tableArn, `${tableArn}/index/*`],
      })
    );
  }

  /**
   * Grant S3 read access to the function's role
   */
  public grantS3Read(bucketArn: string): void {
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [bucketArn, `${bucketArn}/*`],
      })
    );
  }

  /**
   * Grant S3 read/write access to the function's role
   */
  public grantS3ReadWrite(bucketArn: string): void {
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [bucketArn, `${bucketArn}/*`],
      })
    );
  }

  /**
   * Grant KMS decrypt/encrypt access to the function's role
   */
  public grantKmsAccess(keyArn: string): void {
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kms:Decrypt',
          'kms:Encrypt',
          'kms:GenerateDataKey',
          'kms:DescribeKey',
        ],
        resources: [keyArn],
      })
    );
  }

  /**
   * Grant EventBridge PutEvents access to the function's role
   */
  public grantEventBridgePutEvents(eventBusArn: string): void {
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [eventBusArn],
      })
    );
  }
}
