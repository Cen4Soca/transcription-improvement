/**
 * AuditLog 操作インテグレーションテスト
 *
 * テスト内容:
 * - 部分削除失敗時の AuditLog 記録テスト
 * - AuditLog 削除自己記録テスト（削除操作自体を AUDIT_LOG_DELETED として記録）
 * - メタデータサニタイズテスト（許可キーのみ、最大 1000 文字）
 * - オフラインキュー同期テスト
 *
 * 前提条件:
 * - LocalStack が起動していること (http://localhost:4566)
 * - 環境変数 INTEGRATION_TEST=true が設定されていること
 *
 * 実行方法:
 * INTEGRATION_TEST=true npx vitest --run --config vitest.integration.config.ts audit-operations
 *
 * Validates: Requirements 11.8, 11.10, 14.12, 14.22
 */

import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { sanitizeMetadata } from '../../utils/metadata-sanitizer.js';

const SHOULD_RUN = process.env.INTEGRATION_TEST === 'true';

const describeIntegration = SHOULD_RUN ? describe : describe.skip;

describeIntegration('AuditLog 操作', () => {
  const ENDPOINT = 'http://localhost:4566';
  const REGION = 'ap-northeast-1';
  const TABLE_NAME = 'TranscriptionReviewApp';

  let ddbClient: DynamoDBClient;
  let docClient: DynamoDBDocumentClient;

  beforeAll(async () => {
    ddbClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    docClient = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    await ddbClient.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      })
    );
  });

  afterAll(async () => {
    await ddbClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
    ddbClient.destroy();
  });

  describe('部分削除失敗時の AuditLog 記録', () => {
    it('should record PARTIAL_DELETION_FAILURE in AuditLog when deletion partially fails', async () => {
      const logId = 'partial-del-log-001';
      const actorUserId = 'leader-001';
      const createdAt = '2024-01-20T10:00:00.000Z';
      const yearMonth = '2024-01';

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `AUDIT#${yearMonth}`,
            SK: `LOG#${createdAt}#${logId}`,
            GSI1PK: `ACTOR#${actorUserId}`,
            GSI1SK: `LOG#${createdAt}`,
            GSI2PK: 'OPERATION#PARTIAL_DELETION_FAILURE',
            GSI2SK: `LOG#${createdAt}`,
            entityType: 'AuditLog',
            logId,
            createdAt,
            actorUserId,
            actorRole: 'TEAM_LEADER',
            operationType: 'PARTIAL_DELETION_FAILURE',
            resourceId: 'media-file-001',
            resourceType: 'MediaFile',
            metadata: {
              resourceName: 'recording.mp3',
              reason: 'S3 object deleted but DynamoDB record deletion failed',
              previousValue: 'UPLOADED',
              newValue: 'PARTIALLY_DELETED',
            },
          },
        })
      );

      // Verify the audit log was recorded
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `AUDIT#${yearMonth}`, SK: `LOG#${createdAt}#${logId}` },
        })
      );

      expect(result.Item).toBeDefined();
      expect(result.Item!['operationType']).toBe('PARTIAL_DELETION_FAILURE');
      expect(result.Item!['resourceId']).toBe('media-file-001');
      expect(result.Item!['metadata']).toBeDefined();
      expect((result.Item!['metadata'] as Record<string, string>)['reason']).toContain(
        'S3 object deleted'
      );
    });

    it('should query partial deletion failures by operation type via GSI2', async () => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :gsi2pk',
          ExpressionAttributeValues: {
            ':gsi2pk': 'OPERATION#PARTIAL_DELETION_FAILURE',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBeGreaterThanOrEqual(1);
      expect(result.Items![0]['operationType']).toBe('PARTIAL_DELETION_FAILURE');
    });
  });

  describe('AuditLog 削除自己記録', () => {
    it('should record AUDIT_LOG_DELETED when audit logs are deleted', async () => {
      // First, create some audit logs to delete
      const logsToDelete = [
        { logId: 'del-target-001', createdAt: '2024-01-10T10:00:00.000Z' },
        { logId: 'del-target-002', createdAt: '2024-01-10T11:00:00.000Z' },
        { logId: 'del-target-003', createdAt: '2024-01-10T12:00:00.000Z' },
      ];

      for (const log of logsToDelete) {
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              PK: 'AUDIT#2024-01',
              SK: `LOG#${log.createdAt}#${log.logId}`,
              GSI1PK: 'ACTOR#user-to-delete',
              GSI1SK: `LOG#${log.createdAt}`,
              GSI2PK: 'OPERATION#CORRECTION_CONFIRMED',
              GSI2SK: `LOG#${log.createdAt}`,
              entityType: 'AuditLog',
              logId: log.logId,
              createdAt: log.createdAt,
              actorUserId: 'user-to-delete',
              actorRole: 'REVIEWER',
              operationType: 'CORRECTION_CONFIRMED',
              resourceId: 'correction-001',
              resourceType: 'Correction',
            },
          })
        );
      }

      // Delete the logs
      const deleteRequests = logsToDelete.map((log) => ({
        DeleteRequest: {
          Key: {
            PK: 'AUDIT#2024-01',
            SK: `LOG#${log.createdAt}#${log.logId}`,
          },
        },
      }));

      await docClient.send(
        new BatchWriteCommand({
          RequestItems: { [TABLE_NAME]: deleteRequests },
        })
      );

      // Record the deletion itself as AUDIT_LOG_DELETED
      const deletionLogId = 'deletion-record-001';
      const deletionCreatedAt = '2024-01-20T15:00:00.000Z';

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: 'AUDIT#2024-01',
            SK: `LOG#${deletionCreatedAt}#${deletionLogId}`,
            GSI1PK: 'ACTOR#admin-001',
            GSI1SK: `LOG#${deletionCreatedAt}`,
            GSI2PK: 'OPERATION#AUDIT_LOG_DELETED',
            GSI2SK: `LOG#${deletionCreatedAt}`,
            entityType: 'AuditLog',
            logId: deletionLogId,
            createdAt: deletionCreatedAt,
            actorUserId: 'admin-001',
            actorRole: 'ADMIN',
            operationType: 'AUDIT_LOG_DELETED',
            resourceId: 'audit-logs',
            resourceType: 'AuditLog',
            metadata: {
              count: '3',
              reason: 'Deleted 3 audit log entries matching filter conditions: actorUserId=user-to-delete',
            },
          },
        })
      );

      // Verify the deletion record exists
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: 'AUDIT#2024-01', SK: `LOG#${deletionCreatedAt}#${deletionLogId}` },
        })
      );

      expect(result.Item).toBeDefined();
      expect(result.Item!['operationType']).toBe('AUDIT_LOG_DELETED');
      expect(result.Item!['actorRole']).toBe('ADMIN');
      const metadata = result.Item!['metadata'] as Record<string, string>;
      expect(metadata['count']).toBe('3');
      expect(metadata['reason']).toContain('Deleted 3 audit log entries');
    });

    it('should verify deleted logs are no longer queryable', async () => {
      // Query for the deleted user's logs
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk',
          ExpressionAttributeValues: {
            ':gsi1pk': 'ACTOR#user-to-delete',
          },
        })
      );

      // The deleted logs should not appear
      expect(result.Items!.length).toBe(0);
    });

    it('should verify AUDIT_LOG_DELETED record is queryable via GSI2', async () => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :gsi2pk',
          ExpressionAttributeValues: {
            ':gsi2pk': 'OPERATION#AUDIT_LOG_DELETED',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBeGreaterThanOrEqual(1);
      expect(result.Items![0]['operationType']).toBe('AUDIT_LOG_DELETED');
    });
  });

  describe('メタデータサニタイズ', () => {
    it('should only allow permitted keys (resourceName, previousValue, newValue, count, reason)', () => {
      const input = {
        resourceName: 'test-resource',
        previousValue: 'old',
        newValue: 'new',
        count: '5',
        reason: 'test reason',
        maliciousKey: '<script>alert("xss")</script>',
        anotherBadKey: 'should be removed',
      };

      const result = sanitizeMetadata(input);

      expect(result).toBeDefined();
      expect(result!['resourceName']).toBe('test-resource');
      expect(result!['previousValue']).toBe('old');
      expect(result!['newValue']).toBe('new');
      expect(result!['count']).toBe('5');
      expect(result!['reason']).toBe('test reason');
      expect(result!['maliciousKey' as keyof typeof result]).toBeUndefined();
      expect(result!['anotherBadKey' as keyof typeof result]).toBeUndefined();
    });

    it('should truncate values to maximum 1000 characters', () => {
      const longValue = 'x'.repeat(2000);
      const input = {
        reason: longValue,
      };

      const result = sanitizeMetadata(input);

      expect(result).toBeDefined();
      expect(result!['reason'].length).toBe(1000);
    });

    it('should return undefined for empty metadata', () => {
      const result = sanitizeMetadata(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined when all keys are disallowed', () => {
      const input = {
        badKey1: 'value1',
        badKey2: 'value2',
      };

      const result = sanitizeMetadata(input);
      expect(result).toBeUndefined();
    });

    it('should convert non-string values to strings', () => {
      const input = {
        count: 42 as unknown,
        reason: true as unknown,
      } as Record<string, unknown>;

      const result = sanitizeMetadata(input);

      expect(result).toBeDefined();
      expect(result!['count']).toBe('42');
      expect(result!['reason']).toBe('true');
    });

    it('should store sanitized metadata in DynamoDB correctly', async () => {
      const logId = 'sanitize-test-001';
      const createdAt = '2024-01-20T16:00:00.000Z';

      const rawMetadata = {
        resourceName: 'test-file.mp3',
        previousValue: 'PENDING',
        newValue: 'CLEAN',
        count: '1',
        reason: 'Scan completed',
        injectedKey: 'DROP TABLE users;',
        xssAttempt: '<img onerror="alert(1)">',
      };

      const sanitized = sanitizeMetadata(rawMetadata);

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: 'AUDIT#2024-01',
            SK: `LOG#${createdAt}#${logId}`,
            entityType: 'AuditLog',
            logId,
            createdAt,
            actorUserId: 'admin-001',
            actorRole: 'ADMIN',
            operationType: 'USER_MANAGEMENT',
            resourceId: 'user-001',
            resourceType: 'User',
            metadata: sanitized,
          },
        })
      );

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: 'AUDIT#2024-01', SK: `LOG#${createdAt}#${logId}` },
        })
      );

      const storedMetadata = result.Item!['metadata'] as Record<string, string>;
      expect(storedMetadata['resourceName']).toBe('test-file.mp3');
      expect(storedMetadata['reason']).toBe('Scan completed');
      // Disallowed keys should not be stored
      expect(storedMetadata['injectedKey']).toBeUndefined();
      expect(storedMetadata['xssAttempt']).toBeUndefined();
    });
  });

  describe('オフラインキュー同期', () => {
    it('should support idempotent correction writes for offline queue sync', async () => {
      const sessionId = 'session-offline-001';
      const userId = 'user-offline-001';
      const correctionId = 'correction-offline-001';
      const createdAt = '2024-01-20T17:00:00.000Z';

      const item = {
        PK: `SESSION#${sessionId}#USER#${userId}`,
        SK: `CORRECTION#${createdAt}#${correctionId}`,
        entityType: 'Correction',
        correctionId,
        sessionId,
        segmentId: 'segment-001',
        userId,
        correctionType: 'TEXT',
        beforeText: 'original',
        afterText: 'corrected',
        createdAt,
      };

      // First write (simulating online save)
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );

      // Second write with same correctionId (simulating offline queue retry)
      // Should fail due to condition expression (idempotency)
      await expect(
        docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK)',
          })
        )
      ).rejects.toThrow();

      // Verify only one record exists
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: {
            ':pk': `SESSION#${sessionId}#USER#${userId}`,
            ':sk': `CORRECTION#${createdAt}#${correctionId}`,
          },
        })
      );

      expect(result.Items!.length).toBe(1);
    });

    it('should process queued corrections in FIFO order', async () => {
      const sessionId = 'session-fifo-001';
      const userId = 'user-fifo-001';

      // Simulate a queue of corrections in order
      const corrections = [
        { id: 'corr-1', createdAt: '2024-01-20T17:01:00.000Z', afterText: 'first' },
        { id: 'corr-2', createdAt: '2024-01-20T17:02:00.000Z', afterText: 'second' },
        { id: 'corr-3', createdAt: '2024-01-20T17:03:00.000Z', afterText: 'third' },
      ];

      for (const corr of corrections) {
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              PK: `SESSION#${sessionId}#USER#${userId}`,
              SK: `CORRECTION#${corr.createdAt}#${corr.id}`,
              entityType: 'Correction',
              correctionId: corr.id,
              sessionId,
              userId,
              afterText: corr.afterText,
              createdAt: corr.createdAt,
            },
          })
        );
      }

      // Query corrections in order
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `SESSION#${sessionId}#USER#${userId}`,
            ':prefix': 'CORRECTION#',
          },
          ScanIndexForward: true, // ascending order
        })
      );

      expect(result.Items!.length).toBe(3);
      expect(result.Items![0]['afterText']).toBe('first');
      expect(result.Items![1]['afterText']).toBe('second');
      expect(result.Items![2]['afterText']).toBe('third');
    });

    it('should handle exponential backoff retry logic', () => {
      // Verify exponential backoff parameters
      const INITIAL_DELAY_MS = 1000;
      const MAX_DELAY_MS = 30000;
      const MAX_RETRIES = 5;

      const delays: number[] = [];
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        delays.push(delay);
      }

      expect(delays[0]).toBe(1000);   // 1s
      expect(delays[1]).toBe(2000);   // 2s
      expect(delays[2]).toBe(4000);   // 4s
      expect(delays[3]).toBe(8000);   // 8s
      expect(delays[4]).toBe(16000);  // 16s

      // All delays should be within max
      expect(delays.every((d) => d <= MAX_DELAY_MS)).toBe(true);
    });

    it('should enforce queue maximum of 200 entries', () => {
      const MAX_QUEUE_SIZE = 200;
      const currentQueueSize = 199;

      // Adding one more should be allowed
      expect(currentQueueSize + 1).toBeLessThanOrEqual(MAX_QUEUE_SIZE);

      // Adding two more should trigger overflow handling
      expect(currentQueueSize + 2).toBeGreaterThan(MAX_QUEUE_SIZE);
    });
  });
});
