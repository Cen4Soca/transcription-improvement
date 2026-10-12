/**
 * Audit Log Repository
 *
 * DynamoDB data access layer for audit log entries.
 *
 * Key design:
 *   PK: AUDIT#{YYYY-MM}
 *   SK: LOG#{createdAt}#{logId}
 *   GSI1PK: ACTOR#{userId}
 *   GSI1SK: LOG#{createdAt}
 *   GSI2PK: OPERATION#{operationType}
 *   GSI2SK: LOG#{createdAt}
 */

import {
  QueryCommand,
  PutCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

export type AuditOperationType =
  | 'IP_ALLOWLIST_CHANGE'
  | 'USER_MANAGEMENT'
  | 'TEAM_MANAGEMENT'
  | 'REVIEW_ASSIGNMENT_CHANGE'
  | 'TEAM_ASSIGNMENT_CHANGE'
  | 'SESSION_COMPLETED'
  | 'SESSION_NAME_CHANGED'
  | 'SESSION_MANUAL_AGGREGATED'
  | 'SESSION_REOPENED'
  | 'CONSENSUS_MANUAL_CONFIRM'
  | 'CORRECTION_CONFIRMED'
  | 'SPEAKER_LABEL_CHANGED'
  | 'LOGIN_FAILURE'
  | 'MEDIA_DELETED'
  | 'TRANSCRIPTION_DELETED'
  | 'PARTIAL_DELETION_FAILURE'
  | 'LANGUAGE_MODEL_CREATED'
  | 'AUDIT_LOG_DELETED';

export interface AuditLogRecord {
  logId: string;
  createdAt: string;
  actorUserId: string;
  actorRole: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
  operationType: AuditOperationType;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogQueryParams {
  startDate?: string;
  endDate?: string;
  actorUserId?: string;
  operationType?: AuditOperationType;
  page?: number;
}

export interface AuditLogQueryResult {
  items: AuditLogRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 100;

/**
 * Create a new audit log entry in DynamoDB.
 */
export async function putAuditLog(record: AuditLogRecord): Promise<void> {
  const yearMonth = record.createdAt.substring(0, 7); // YYYY-MM

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `AUDIT#${yearMonth}`,
        SK: `LOG#${record.createdAt}#${record.logId}`,
        GSI1PK: `ACTOR#${record.actorUserId}`,
        GSI1SK: `LOG#${record.createdAt}`,
        GSI2PK: `OPERATION#${record.operationType}`,
        GSI2SK: `LOG#${record.createdAt}`,
        entityType: 'AuditLog',
        logId: record.logId,
        createdAt: record.createdAt,
        actorUserId: record.actorUserId,
        actorRole: record.actorRole,
        operationType: record.operationType,
        resourceId: record.resourceId,
        resourceType: record.resourceType,
        metadata: record.metadata,
      },
    })
  );
}

/**
 * Query audit logs with optional filters and pagination.
 *
 * Filter strategies:
 * - actorUserId: Uses GSI1 (ACTOR#{userId})
 * - operationType: Uses GSI2 (OPERATION#{operationType})
 * - date range only: Queries by PK (AUDIT#{YYYY-MM}) across months
 * - no filter: Queries all months
 */
export async function queryAuditLogs(
  params: AuditLogQueryParams
): Promise<AuditLogQueryResult> {
  const page = params.page ?? 1;
  const { startDate, endDate, actorUserId, operationType } = params;

  let allItems: AuditLogRecord[];

  if (actorUserId) {
    allItems = await queryByActor(actorUserId, startDate, endDate);
  } else if (operationType) {
    allItems = await queryByOperationType(operationType, startDate, endDate);
  } else {
    allItems = await queryByDateRange(startDate, endDate);
  }

  // Sort by createdAt descending (most recent first)
  allItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const totalCount = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startIndex = (page - 1) * PAGE_SIZE;
  const paginatedItems = allItems.slice(startIndex, startIndex + PAGE_SIZE);

  return {
    items: paginatedItems,
    totalCount,
    page,
    pageSize: PAGE_SIZE,
    totalPages,
  };
}

/**
 * Delete audit logs matching the given filter criteria.
 * Returns the number of deleted entries.
 */
export async function deleteAuditLogs(
  params: Omit<AuditLogQueryParams, 'page'>
): Promise<number> {
  const { startDate, endDate, actorUserId, operationType } = params;

  let allItems: AuditLogRecord[];

  if (actorUserId) {
    allItems = await queryByActor(actorUserId, startDate, endDate);
  } else if (operationType) {
    allItems = await queryByOperationType(operationType, startDate, endDate);
  } else {
    allItems = await queryByDateRange(startDate, endDate);
  }

  if (allItems.length === 0) {
    return 0;
  }

  // Delete in batches of 25 (DynamoDB BatchWriteItem limit)
  const batchSize = 25;
  for (let i = 0; i < allItems.length; i += batchSize) {
    const batch = allItems.slice(i, i + batchSize);
    const deleteRequests = batch.map((item) => {
      const yearMonth = item.createdAt.substring(0, 7);
      return {
        DeleteRequest: {
          Key: {
            PK: `AUDIT#${yearMonth}`,
            SK: `LOG#${item.createdAt}#${item.logId}`,
          },
        },
      };
    });

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: deleteRequests,
        },
      })
    );
  }

  return allItems.length;
}

/**
 * Query audit logs by actor using GSI1.
 */
async function queryByActor(
  actorUserId: string,
  startDate?: string,
  endDate?: string
): Promise<AuditLogRecord[]> {
  let keyCondition = 'GSI1PK = :gsi1pk';
  const expressionValues: Record<string, unknown> = {
    ':gsi1pk': `ACTOR#${actorUserId}`,
  };

  if (startDate && endDate) {
    keyCondition += ' AND GSI1SK BETWEEN :start AND :end';
    expressionValues[':start'] = `LOG#${startDate}`;
    expressionValues[':end'] = `LOG#${endDate}\uffff`;
  } else if (startDate) {
    keyCondition += ' AND GSI1SK >= :start';
    expressionValues[':start'] = `LOG#${startDate}`;
  } else if (endDate) {
    keyCondition += ' AND GSI1SK <= :end';
    expressionValues[':end'] = `LOG#${endDate}\uffff`;
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionValues,
    })
  );

  return (result.Items ?? []).map(mapItemToAuditLog);
}

/**
 * Query audit logs by operation type using GSI2.
 */
async function queryByOperationType(
  operationType: AuditOperationType,
  startDate?: string,
  endDate?: string
): Promise<AuditLogRecord[]> {
  let keyCondition = 'GSI2PK = :gsi2pk';
  const expressionValues: Record<string, unknown> = {
    ':gsi2pk': `OPERATION#${operationType}`,
  };

  if (startDate && endDate) {
    keyCondition += ' AND GSI2SK BETWEEN :start AND :end';
    expressionValues[':start'] = `LOG#${startDate}`;
    expressionValues[':end'] = `LOG#${endDate}\uffff`;
  } else if (startDate) {
    keyCondition += ' AND GSI2SK >= :start';
    expressionValues[':start'] = `LOG#${startDate}`;
  } else if (endDate) {
    keyCondition += ' AND GSI2SK <= :end';
    expressionValues[':end'] = `LOG#${endDate}\uffff`;
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionValues,
    })
  );

  return (result.Items ?? []).map(mapItemToAuditLog);
}

/**
 * Query audit logs by date range using the primary key (AUDIT#{YYYY-MM}).
 * Generates month partitions between startDate and endDate.
 */
async function queryByDateRange(
  startDate?: string,
  endDate?: string
): Promise<AuditLogRecord[]> {
  const months = getMonthPartitions(startDate, endDate);
  const allItems: AuditLogRecord[] = [];

  for (const month of months) {
    let keyCondition = 'PK = :pk';
    const expressionValues: Record<string, unknown> = {
      ':pk': `AUDIT#${month}`,
    };

    if (startDate && endDate) {
      keyCondition += ' AND SK BETWEEN :start AND :end';
      expressionValues[':start'] = `LOG#${startDate}`;
      expressionValues[':end'] = `LOG#${endDate}\uffff`;
    } else if (startDate) {
      keyCondition += ' AND SK >= :start';
      expressionValues[':start'] = `LOG#${startDate}`;
    } else if (endDate) {
      keyCondition += ' AND SK <= :end';
      expressionValues[':end'] = `LOG#${endDate}\uffff`;
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues,
      })
    );

    const items = (result.Items ?? []).map(mapItemToAuditLog);
    allItems.push(...items);
  }

  return allItems;
}

/**
 * Generate month partition keys between startDate and endDate.
 * If no dates provided, returns the last 12 months.
 */
export function getMonthPartitions(
  startDate?: string,
  endDate?: string
): string[] {
  const now = new Date();

  const end = endDate ? new Date(endDate) : now;
  const start = startDate
    ? new Date(startDate)
    : new Date(now.getFullYear() - 1, now.getMonth(), 1);

  const months: string[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

/**
 * Map a DynamoDB item to an AuditLogRecord.
 */
function mapItemToAuditLog(item: Record<string, unknown>): AuditLogRecord {
  return {
    logId: item['logId'] as string,
    createdAt: item['createdAt'] as string,
    actorUserId: item['actorUserId'] as string,
    actorRole: item['actorRole'] as AuditLogRecord['actorRole'],
    operationType: item['operationType'] as AuditOperationType,
    resourceId: item['resourceId'] as string,
    resourceType: item['resourceType'] as string,
    metadata: item['metadata'] as Record<string, unknown> | undefined,
  };
}
