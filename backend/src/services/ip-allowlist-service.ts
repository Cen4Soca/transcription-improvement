/**
 * IP Allowlist Service
 *
 * Business logic for managing IP allowlist entries including
 * CIDR validation, DynamoDB persistence, WAF IP set updates,
 * and audit log recording.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  WAFV2Client,
  GetIPSetCommand,
  UpdateIPSetCommand,
} from '@aws-sdk/client-wafv2';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';
import { validateCIDR } from '../utils/cidr-validator.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { putAuditLog } from '../repositories/audit-repository.js';
import type { AuthUser } from '../utils/auth-middleware.js';

const MAX_ENTRIES = 1000;
const WAF_IP_SET_ID = process.env.WAF_IP_SET_ID ?? '';
const WAF_IP_SET_NAME = process.env.WAF_IP_SET_NAME ?? '';
const WAF_SCOPE = (process.env.WAF_SCOPE ?? 'REGIONAL') as 'REGIONAL' | 'CLOUDFRONT';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const wafClient = new WAFV2Client({ region: REGION });

export interface IPAllowlistEntry {
  entryId: string;
  cidr: string;
  description?: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Retrieves all IP allowlist entries from DynamoDB.
 */
export async function getAllEntries(): Promise<IPAllowlistEntry[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': 'IPALLOWLIST',
        ':skPrefix': 'ENTRY#',
      },
    })
  );

  return (result.Items ?? []).map(itemToEntry);
}

/**
 * Adds a new IP allowlist entry.
 *
 * Validates CIDR format and enforces the 1,000 entry limit.
 * After successful addition, triggers WAF IP set update and records audit log.
 */
export async function addEntry(params: {
  cidr: string;
  description?: string;
  createdBy: string;
  actor?: AuthUser;
}): Promise<IPAllowlistEntry> {
  const { cidr, description, createdBy, actor } = params;

  // Validate CIDR format (Req 14.15)
  if (!validateCIDR(cidr)) {
    throw validationError(
      'CIDR形式が無効です。IPv4（例: 192.168.1.0/24）またはIPv6（例: 2001:db8::/32）の形式で入力してください。'
    );
  }

  // Check max entries limit (Req 14.3)
  const currentEntries = await getAllEntries();
  if (currentEntries.length >= MAX_ENTRIES) {
    throw validationError(
      `IPアドレス許可リストの最大件数（${MAX_ENTRIES}件）に達しています。既存のエントリを削除してから追加してください。`
    );
  }

  // Check for duplicate CIDR
  const isDuplicate = currentEntries.some((entry) => entry.cidr === cidr.trim());
  if (isDuplicate) {
    throw validationError('このCIDRブロックは既に登録されています。');
  }

  const entryId = uuidv4();
  const createdAt = new Date().toISOString();

  const entry: IPAllowlistEntry = {
    entryId,
    cidr: cidr.trim(),
    description: description?.trim(),
    createdAt,
    createdBy,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'IPALLOWLIST',
        SK: `ENTRY#${entryId}`,
        entityType: 'IPAllowlistEntry',
        entryId,
        cidr: entry.cidr,
        description: entry.description,
        createdAt,
        createdBy,
      },
    })
  );

  // Update WAF IP set (Req 14.4 - changes reflected within 30 minutes)
  await updateWafIpSet([...currentEntries, entry]);

  // Record audit log (Req 14.8)
  if (actor) {
    await putAuditLog({
      logId: uuidv4(),
      createdAt,
      actorUserId: actor.userId,
      actorRole: actor.role,
      operationType: 'IP_ALLOWLIST_CHANGE',
      resourceId: entryId,
      resourceType: 'IPAllowlistEntry',
      metadata: {
        action: 'ADD',
        cidr: entry.cidr,
        description: entry.description ?? '',
      },
    });
  }

  return entry;
}

/**
 * Deletes an IP allowlist entry by entryId.
 *
 * After successful deletion, triggers WAF IP set update and records audit log.
 */
export async function deleteEntry(entryId: string, actor?: AuthUser): Promise<void> {
  // Verify entry exists
  const currentEntries = await getAllEntries();
  const targetEntry = currentEntries.find((e) => e.entryId === entryId);

  if (!targetEntry) {
    throw validationError('指定されたIPアドレスエントリが見つかりません。');
  }

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: 'IPALLOWLIST',
        SK: `ENTRY#${entryId}`,
      },
    })
  );

  // Update WAF IP set with remaining entries (Req 14.4)
  const remainingEntries = currentEntries.filter((e) => e.entryId !== entryId);
  await updateWafIpSet(remainingEntries);

  // Record audit log (Req 14.8)
  if (actor) {
    const now = new Date().toISOString();
    await putAuditLog({
      logId: uuidv4(),
      createdAt: now,
      actorUserId: actor.userId,
      actorRole: actor.role,
      operationType: 'IP_ALLOWLIST_CHANGE',
      resourceId: entryId,
      resourceType: 'IPAllowlistEntry',
      metadata: {
        action: 'DELETE',
        cidr: targetEntry.cidr,
        description: targetEntry.description ?? '',
      },
    });
  }
}

/**
 * Updates the WAF IP set with the current list of CIDR entries.
 *
 * When the list is empty, the WAF IP set is cleared, effectively disabling
 * IP-based restrictions (Req 14.6).
 * Changes propagate within 30 minutes (Req 14.4).
 *
 * Fail-closed: If the WAF update fails, an error is thrown to prevent
 * the operation from completing silently (Req 14.5).
 */
async function updateWafIpSet(entries: IPAllowlistEntry[]): Promise<void> {
  if (!WAF_IP_SET_ID || !WAF_IP_SET_NAME) {
    // WAF IP set not configured; skip update in development
    console.warn('WAF IP set not configured (WAF_IP_SET_ID or WAF_IP_SET_NAME missing). Skipping WAF update.');
    return;
  }

  try {
    // Get current IP set to obtain LockToken (required for optimistic locking)
    const getResult = await wafClient.send(
      new GetIPSetCommand({
        Name: WAF_IP_SET_NAME,
        Scope: WAF_SCOPE,
        Id: WAF_IP_SET_ID,
      })
    );

    const lockToken = getResult.LockToken;
    if (!lockToken) {
      throw new Error('Failed to obtain WAF IP set LockToken');
    }

    // Update IP set with new addresses
    await wafClient.send(
      new UpdateIPSetCommand({
        Name: WAF_IP_SET_NAME,
        Scope: WAF_SCOPE,
        Id: WAF_IP_SET_ID,
        LockToken: lockToken,
        Addresses: entries.map((e) => e.cidr),
      })
    );

    console.log(
      `WAF IP set updated successfully: ${entries.length} entries`,
      { wafIpSetId: WAF_IP_SET_ID, entryCount: entries.length }
    );
  } catch (error: unknown) {
    // Fail-closed: WAF update failure must reject the operation (Req 14.5)
    console.error('WAF IP set update failed:', error);
    throw internalError(
      'WAF IPセットの更新に失敗しました。',
      error instanceof Error ? error.message : undefined
    );
  }
}

/**
 * Maps a DynamoDB item to an IPAllowlistEntry.
 */
function itemToEntry(item: Record<string, unknown>): IPAllowlistEntry {
  return {
    entryId: item.entryId as string,
    cidr: item.cidr as string,
    description: item.description as string | undefined,
    createdAt: item.createdAt as string,
    createdBy: item.createdBy as string,
  };
}
