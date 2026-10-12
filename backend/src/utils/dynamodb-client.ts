import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const ddbClient = new DynamoDBClient({ region: REGION });

export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const TABLE_NAME =
  process.env.DYNAMODB_TABLE_NAME ?? 'TranscriptionReviewApp';
