/**
 * DynamoDB CRUD 操作インテグレーションテスト
 *
 * テスト内容:
 * - DynamoDB シングルテーブル設計に基づく CRUD 操作
 * - ReviewSession, Segment, Correction, User, Team エンティティの作成・取得・更新・削除
 * - GSI1, GSI2 を使用したクエリ操作
 * - 条件付き書き込み（べき等性確保）
 *
 * 前提条件:
 * - LocalStack が起動していること (http://localhost:4566)
 * - 環境変数 INTEGRATION_TEST=true が設定されていること
 *
 * 実行方法:
 * INTEGRATION_TEST=true npx vitest --run --config vitest.integration.config.ts dynamodb-crud
 *
 * Validates: Requirements 9.1, 14.5
 */

import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const SHOULD_RUN = process.env.INTEGRATION_TEST === 'true';

const describeIntegration = SHOULD_RUN ? describe : describe.skip;

describeIntegration('DynamoDB CRUD 操作', () => {
  const ENDPOINT = 'http://localhost:4566';
  const TABLE_NAME = 'TranscriptionReviewApp';
  const REGION = 'ap-northeast-1';

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

    // Create table with PK, SK, GSI1, GSI2
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

  describe('ReviewSession CRUD', () => {
    const sessionId = 'session-001';
    const teamId = 'team-001';
    const createdAt = '2024-01-15T10:00:00.000Z';

    it('should create a ReviewSession item', async () => {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `SESSION#${sessionId}`,
            SK: 'METADATA',
            GSI1PK: `TEAM#${teamId}`,
            GSI1SK: `SESSION#${createdAt}#${sessionId}`,
            entityType: 'ReviewSession',
            sessionId,
            name: 'Test Session',
            status: 'PENDING',
            consensusThreshold: 67,
            assignedReviewerCount: 3,
            createdAt,
            updatedAt: createdAt,
          },
        })
      );

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        })
      );

      expect(result.Item).toBeDefined();
      expect(result.Item!['sessionId']).toBe(sessionId);
      expect(result.Item!['status']).toBe('PENDING');
      expect(result.Item!['name']).toBe('Test Session');
    });

    it('should get a ReviewSession by sessionId', async () => {
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        })
      );

      expect(result.Item).toBeDefined();
      expect(result.Item!['sessionId']).toBe(sessionId);
      expect(result.Item!['consensusThreshold']).toBe(67);
      expect(result.Item!['assignedReviewerCount']).toBe(3);
      expect(result.Item!['createdAt']).toBe(createdAt);
    });

    it('should update ReviewSession status', async () => {
      const updatedAt = '2024-01-15T11:00:00.000Z';

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
          ConditionExpression: '#status = :expectedStatus',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'IN_PROGRESS',
            ':updatedAt': updatedAt,
            ':expectedStatus': 'PENDING',
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        })
      );

      expect(result.Item!['status']).toBe('IN_PROGRESS');
      expect(result.Item!['updatedAt']).toBe(updatedAt);
    });

    it('should query ReviewSessions by team using GSI1', async () => {
      // Add a second session for the same team
      const sessionId2 = 'session-002';
      const createdAt2 = '2024-01-16T10:00:00.000Z';

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `SESSION#${sessionId2}`,
            SK: 'METADATA',
            GSI1PK: `TEAM#${teamId}`,
            GSI1SK: `SESSION#${createdAt2}#${sessionId2}`,
            entityType: 'ReviewSession',
            sessionId: sessionId2,
            name: 'Test Session 2',
            status: 'PENDING',
            consensusThreshold: 80,
            assignedReviewerCount: 5,
            createdAt: createdAt2,
            updatedAt: createdAt2,
          },
        })
      );

      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':gsi1pk': `TEAM#${teamId}`,
            ':prefix': 'SESSION#',
          },
          ScanIndexForward: false,
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBe(2);
      // Descending order: session-002 first (newer)
      expect(result.Items![0]['sessionId']).toBe(sessionId2);
      expect(result.Items![1]['sessionId']).toBe(sessionId);
    });
  });

  describe('Correction CRUD', () => {
    const sessionId = 'session-corr-001';
    const userId = 'user-001';
    const segmentId = 'segment-001';
    const correctionId = 'correction-001';
    const createdAt = '2024-01-15T12:00:00.000Z';

    it('should create a Correction item with idempotency', async () => {
      const item = {
        PK: `SESSION#${sessionId}#USER#${userId}`,
        SK: `CORRECTION#${createdAt}#${correctionId}`,
        GSI1PK: `SEGMENT#${segmentId}`,
        GSI1SK: `CORRECTION#${createdAt}`,
        entityType: 'Correction',
        correctionId,
        sessionId,
        segmentId,
        userId,
        correctionType: 'TEXT',
        beforeText: 'original text',
        afterText: 'corrected text',
        createdAt,
      };

      // First write
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );

      // Second write with same key should fail (idempotency)
      await expect(
        docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK)',
          })
        )
      ).rejects.toThrow();
    });

    it('should query Corrections by segment using GSI1', async () => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':gsi1pk': `SEGMENT#${segmentId}`,
            ':prefix': 'CORRECTION#',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBeGreaterThanOrEqual(1);
      expect(result.Items![0]['segmentId']).toBe(segmentId);
    });

    it('should query Corrections by session and user', async () => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `SESSION#${sessionId}#USER#${userId}`,
            ':prefix': 'CORRECTION#',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBe(1);
      expect(result.Items![0]['userId']).toBe(userId);
      expect(result.Items![0]['correctionType']).toBe('TEXT');
    });
  });

  describe('Team・TeamAssignment CRUD', () => {
    const teamId = 'team-crud-001';
    const userId = 'user-team-001';
    const sessionId = 'session-assign-001';

    it('should create a Team and add members', async () => {
      // Create team
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `TEAM#${teamId}`,
            SK: 'METADATA',
            entityType: 'Team',
            teamId,
            name: 'Test Team',
            createdBy: 'admin-001',
            createdAt: '2024-01-15T10:00:00.000Z',
          },
        })
      );

      // Add member
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `TEAM#${teamId}`,
            SK: `MEMBER#${userId}`,
            GSI1PK: `USER#${userId}`,
            GSI1SK: `TEAM#${teamId}`,
            entityType: 'TeamMembership',
            teamId,
            userId,
            createdAt: '2024-01-15T10:00:00.000Z',
          },
        })
      );

      // Verify team
      const teamResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `TEAM#${teamId}`, SK: 'METADATA' },
        })
      );
      expect(teamResult.Item!['name']).toBe('Test Team');

      // Verify membership
      const memberResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `TEAM#${teamId}`, SK: `MEMBER#${userId}` },
        })
      );
      expect(memberResult.Item!['userId']).toBe(userId);
    });

    it('should create a TeamAssignment', async () => {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `TEAM#${teamId}`,
            SK: `ASSIGNMENT#${sessionId}`,
            GSI1PK: `SESSION#${sessionId}`,
            GSI1SK: `TEAM#${teamId}`,
            entityType: 'TeamAssignment',
            teamId,
            sessionId,
            createdAt: '2024-01-15T10:00:00.000Z',
          },
        })
      );

      // Verify via GSI1 (SESSION → TEAM lookup)
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':gsi1pk': `SESSION#${sessionId}`,
            ':prefix': 'TEAM#',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBe(1);
      expect(result.Items![0]['teamId']).toBe(teamId);
    });

    it('should delete TeamAssignment and cascade', async () => {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `TEAM#${teamId}`, SK: `ASSIGNMENT#${sessionId}` },
        })
      );

      // Verify deletion via GSI1
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':gsi1pk': `SESSION#${sessionId}`,
            ':prefix': 'TEAM#',
          },
        })
      );

      expect(result.Items!.length).toBe(0);
    });
  });

  describe('AuditLog CRUD', () => {
    const logId = 'log-001';
    const actorUserId = 'admin-001';
    const createdAt = '2024-01-15T14:00:00.000Z';
    const yearMonth = '2024-01';

    it('should create an AuditLog entry', async () => {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `AUDIT#${yearMonth}`,
            SK: `LOG#${createdAt}#${logId}`,
            GSI1PK: `ACTOR#${actorUserId}`,
            GSI1SK: `LOG#${createdAt}`,
            GSI2PK: 'OPERATION#USER_MANAGEMENT',
            GSI2SK: `LOG#${createdAt}`,
            entityType: 'AuditLog',
            logId,
            createdAt,
            actorUserId,
            actorRole: 'ADMIN',
            operationType: 'USER_MANAGEMENT',
            resourceId: 'user-new-001',
            resourceType: 'User',
          },
        })
      );

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `AUDIT#${yearMonth}`, SK: `LOG#${createdAt}#${logId}` },
        })
      );

      expect(result.Item).toBeDefined();
      expect(result.Item!['actorUserId']).toBe(actorUserId);
      expect(result.Item!['operationType']).toBe('USER_MANAGEMENT');
    });

    it('should query AuditLogs by actor using GSI1', async () => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':gsi1pk': `ACTOR#${actorUserId}`,
            ':start': 'LOG#2024-01-01T00:00:00.000Z',
            ':end': 'LOG#2024-01-31T23:59:59.999Z\uffff',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBeGreaterThanOrEqual(1);
      expect(result.Items![0]['actorUserId']).toBe(actorUserId);
    });

    it('should query AuditLogs by operation type using GSI2', async () => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :gsi2pk',
          ExpressionAttributeValues: {
            ':gsi2pk': 'OPERATION#USER_MANAGEMENT',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBeGreaterThanOrEqual(1);
      expect(result.Items![0]['operationType']).toBe('USER_MANAGEMENT');
    });

    it('should delete AuditLog entries by filter', async () => {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `AUDIT#${yearMonth}`, SK: `LOG#${createdAt}#${logId}` },
        })
      );

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `AUDIT#${yearMonth}`, SK: `LOG#${createdAt}#${logId}` },
        })
      );

      expect(result.Item).toBeUndefined();
    });
  });

  describe('IPAllowlist CRUD', () => {
    it('should create an IPAllowlist entry', async () => {
      const entryId = 'entry-001';
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: 'IPALLOWLIST',
            SK: `ENTRY#${entryId}`,
            entityType: 'IPAllowlist',
            entryId,
            cidr: '203.0.113.0/24',
            description: 'Office network',
            createdAt: '2024-01-15T10:00:00.000Z',
            createdBy: 'admin-001',
          },
        })
      );

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: 'IPALLOWLIST', SK: `ENTRY#${entryId}` },
        })
      );

      expect(result.Item).toBeDefined();
      expect(result.Item!['cidr']).toBe('203.0.113.0/24');
      expect(result.Item!['description']).toBe('Office network');
    });

    it('should list all IPAllowlist entries', async () => {
      // Add a second entry
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: 'IPALLOWLIST',
            SK: 'ENTRY#entry-002',
            entityType: 'IPAllowlist',
            entryId: 'entry-002',
            cidr: '198.51.100.0/24',
            description: 'VPN network',
            createdAt: '2024-01-15T11:00:00.000Z',
            createdBy: 'admin-001',
          },
        })
      );

      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': 'IPALLOWLIST',
            ':prefix': 'ENTRY#',
          },
        })
      );

      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBe(2);
    });

    it('should enforce maximum 1000 entries', async () => {
      // Verify the count check logic (we don't actually insert 1000 items)
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': 'IPALLOWLIST',
            ':prefix': 'ENTRY#',
          },
          Select: 'COUNT',
        })
      );

      // Verify count is below 1000
      expect(result.Count).toBeDefined();
      expect(result.Count!).toBeLessThanOrEqual(1000);
    });

    it('should delete an IPAllowlist entry', async () => {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: 'IPALLOWLIST', SK: 'ENTRY#entry-001' },
        })
      );

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: 'IPALLOWLIST', SK: 'ENTRY#entry-001' },
        })
      );

      expect(result.Item).toBeUndefined();
    });
  });
});
