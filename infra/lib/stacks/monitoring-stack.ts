import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  /** API Gateway HTTP API ID */
  apiId: string;
  /** API Gateway HTTP API name */
  apiName: string;
  /** DynamoDB table name */
  tableName: string;
  /** Lambda function names to monitor */
  lambdaFunctionNames: string[];
  /** Lambda error-rate alarm threshold in percent */
  lambdaErrorRatePercent: number;
  /** DynamoDB throttle-events alarm threshold (read + write count) */
  dynamoThrottleCount: number;
  /** API Gateway 4xx error-rate alarm threshold in percent */
  fourxxRatePercent: number;
  /** API Gateway 5xx error-rate alarm threshold in percent */
  fivexxRatePercent: number;
}

export class MonitoringStack extends cdk.Stack {
  public readonly lambdaErrorAlarm: cloudwatch.Alarm;
  public readonly dynamoDbThrottleAlarm: cloudwatch.Alarm;
  public readonly apiGateway4xxAlarm: cloudwatch.Alarm;
  public readonly apiGateway5xxAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // --- Lambda Error Rate Alarm ---
    // Uses math expression: error rate = (errors / invocations) * 100
    // Alarm triggers when error rate exceeds 5%
    const lambdaErrors = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const lambdaInvocations = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Invocations',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const lambdaErrorRate = new cloudwatch.MathExpression({
      expression: 'IF(invocations > 0, (errors / invocations) * 100, 0)',
      usingMetrics: {
        errors: lambdaErrors,
        invocations: lambdaInvocations,
      },
      period: cdk.Duration.minutes(5),
      label: 'Lambda Error Rate (%)',
    });

    this.lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorRateAlarm', {
      alarmName: `${id}-LambdaErrorRate`,
      alarmDescription: `Lambda error rate exceeds ${props.lambdaErrorRatePercent}% over 5 minutes`,
      metric: lambdaErrorRate,
      threshold: props.lambdaErrorRatePercent,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- DynamoDB Throttling Alarm ---
    // Monitors ReadThrottleEvents and WriteThrottleEvents on the table
    const dynamoDbReadThrottle = new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ReadThrottleEvents',
      dimensionsMap: { TableName: props.tableName },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const dynamoDbWriteThrottle = new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'WriteThrottleEvents',
      dimensionsMap: { TableName: props.tableName },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const dynamoDbTotalThrottle = new cloudwatch.MathExpression({
      expression: 'readThrottle + writeThrottle',
      usingMetrics: {
        readThrottle: dynamoDbReadThrottle,
        writeThrottle: dynamoDbWriteThrottle,
      },
      period: cdk.Duration.minutes(5),
      label: 'DynamoDB Total Throttle Events',
    });

    this.dynamoDbThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoDbThrottleAlarm', {
      alarmName: `${id}-DynamoDbThrottle`,
      alarmDescription: `DynamoDB throttle events exceed threshold (read + write > ${props.dynamoThrottleCount} in 5 minutes)`,
      metric: dynamoDbTotalThrottle,
      threshold: props.dynamoThrottleCount,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- API Gateway 4xx Alarm ---
    const apiGateway4xx = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4xx',
      dimensionsMap: { ApiId: props.apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const apiGatewayCount = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: { ApiId: props.apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const apiGateway4xxRate = new cloudwatch.MathExpression({
      expression: 'IF(totalCount > 0, (errors4xx / totalCount) * 100, 0)',
      usingMetrics: {
        errors4xx: apiGateway4xx,
        totalCount: apiGatewayCount,
      },
      period: cdk.Duration.minutes(5),
      label: 'API Gateway 4xx Rate (%)',
    });

    this.apiGateway4xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway4xxAlarm', {
      alarmName: `${id}-ApiGateway4xxRate`,
      alarmDescription: `API Gateway 4xx error rate exceeds ${props.fourxxRatePercent}% over 5 minutes`,
      metric: apiGateway4xxRate,
      threshold: props.fourxxRatePercent,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- API Gateway 5xx Alarm ---
    const apiGateway5xx = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: props.apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const apiGateway5xxRate = new cloudwatch.MathExpression({
      expression: 'IF(totalCount > 0, (errors5xx / totalCount) * 100, 0)',
      usingMetrics: {
        errors5xx: apiGateway5xx,
        totalCount: apiGatewayCount,
      },
      period: cdk.Duration.minutes(5),
      label: 'API Gateway 5xx Rate (%)',
    });

    this.apiGateway5xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: `${id}-ApiGateway5xxRate`,
      alarmDescription: `API Gateway 5xx error rate exceeds ${props.fivexxRatePercent}% over 5 minutes`,
      metric: apiGateway5xxRate,
      threshold: props.fivexxRatePercent,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- CloudFormation Outputs ---
    new cdk.CfnOutput(this, 'LambdaErrorRateAlarmArn', {
      value: this.lambdaErrorAlarm.alarmArn,
      exportName: `${id}-LambdaErrorRateAlarmArn`,
    });

    new cdk.CfnOutput(this, 'DynamoDbThrottleAlarmArn', {
      value: this.dynamoDbThrottleAlarm.alarmArn,
      exportName: `${id}-DynamoDbThrottleAlarmArn`,
    });

    new cdk.CfnOutput(this, 'ApiGateway4xxAlarmArn', {
      value: this.apiGateway4xxAlarm.alarmArn,
      exportName: `${id}-ApiGateway4xxAlarmArn`,
    });

    new cdk.CfnOutput(this, 'ApiGateway5xxAlarmArn', {
      value: this.apiGateway5xxAlarm.alarmArn,
      exportName: `${id}-ApiGateway5xxAlarmArn`,
    });
  }
}
