/**
 * E2E テスト用シードデータ投入スクリプト
 *
 * DynamoDB に ReviewSession, Segment, Correction, Team,
 * ContributorScore, IPAllowlist, AuditLog のテストデータを投入する。
 *
 * 使い方:
 *   cd e2e && npx tsx seed/seed-data.ts
 *
 * 前提:
 *   - .env に AWS_REGION, DYNAMODB_TABLE_NAME が設定済み
 *   - AWS プロファイルが設定済み（team_admin）
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'TranscriptionReviewApp';
const REGION = process.env.AWS_REGION || 'ap-northeast-1';

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// ============================================================
// Constants
// ============================================================

const ADMIN_USER_ID = 'e2e-admin-user-001';
const TEAM_ID = 'e2e-team-001';
const PREFIX = 'e2e-';

function uuid(): string {
  return `${PREFIX}${crypto.randomUUID()}`;
}

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function padStartTime(seconds: number): string {
  return seconds.toFixed(3).padStart(9, '0');
}

function invertScore(score: number): string {
  // Invert score for descending sort (max 99999.9)
  return (99999.9 - score).toFixed(1).padStart(9, '0');
}

// ============================================================
// Batch write helper (25 items per batch)
// ============================================================

async function batchPut(items: Record<string, unknown>[]) {
  const batches: Record<string, unknown>[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  for (const batch of batches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      })
    );
  }
}

// ============================================================
// 1. ReviewSessions (65 records for pagination testing)
// ============================================================

function generateSessions(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const statuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;

  for (let i = 1; i <= 65; i++) {
    const sessionId = `${PREFIX}session-${String(i).padStart(3, '0')}`;
    const status = statuses[i % 3];
    const createdAt = isoDate(65 - i); // oldest first

    items.push({
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
      entityType: 'ReviewSession',
      sessionId,
      transcriptionJobId: `${PREFIX}job-${String(i).padStart(3, '0')}`,
      name: `テストセッション ${i}`,
      status,
      assignedReviewerCount: 3,
      consensusThreshold: 3,
      partialAggregationEnabled: false,
      createdAt,
      updatedAt: createdAt,
      // GSI1 for team-based query
      GSI1PK: `TEAM#${TEAM_ID}`,
      GSI1SK: `SESSION#${createdAt}#${sessionId}`,
    });
  }

  return items;
}

// ============================================================
// 2. Segments (for first 3 sessions, 5 segments each)
// ============================================================

function generateSegments(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  for (let s = 1; s <= 3; s++) {
    const sessionId = `${PREFIX}session-${String(s).padStart(3, '0')}`;

    for (let seg = 0; seg < 5; seg++) {
      const segmentId = `${PREFIX}seg-${s}-${seg}`;
      const startTime = seg * 5.0;
      const endTime = startTime + 4.5;
      const startTimePadded = padStartTime(startTime);

      items.push({
        PK: `SESSION#${sessionId}`,
        SK: `SEGMENT#${startTimePadded}#${segmentId}`,
        entityType: 'Segment',
        segmentId,
        sessionId,
        startTime,
        endTime,
        originalText: `これはセグメント ${seg + 1} のテキストです。セッション ${s} のサンプルデータ。`,
        speakerLabel: `spk_${seg % 2}`,
        consensusStatus: 'UNDECIDED',
        createdAt: isoDate(60 - s),
      });
    }
  }

  return items;
}

// ============================================================
// 3. Corrections (10 records across sessions)
// ============================================================

function generateCorrections(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const userIds = [`${PREFIX}reviewer-001`, `${PREFIX}reviewer-002`, `${PREFIX}reviewer-003`];

  for (let i = 0; i < 10; i++) {
    const sessionIdx = (i % 3) + 1;
    const sessionId = `${PREFIX}session-${String(sessionIdx).padStart(3, '0')}`;
    const segIdx = i % 5;
    const segmentId = `${PREFIX}seg-${sessionIdx}-${segIdx}`;
    const userId = userIds[i % 3];
    const correctionId = `${PREFIX}corr-${String(i + 1).padStart(3, '0')}`;
    const createdAt = isoDate(50 - i);

    items.push({
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
      beforeText: `これはセグメント ${segIdx + 1} のテキストです。`,
      afterText: `これは修正されたセグメント ${segIdx + 1} のテキストです。`,
      createdAt,
    });
  }

  return items;
}

// ============================================================
// 4. Teams + Members + Assignments
// ============================================================

function generateTeamData(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const now = isoDate(0);

  // Team 1
  items.push({
    PK: `TEAM#${TEAM_ID}`,
    SK: 'METADATA',
    entityType: 'Team',
    teamId: TEAM_ID,
    name: 'E2E テストチーム A',
    createdBy: ADMIN_USER_ID,
    createdAt: isoDate(90),
    updatedAt: isoDate(90),
  });

  // Team 2
  const team2Id = `${PREFIX}team-002`;
  items.push({
    PK: `TEAM#${team2Id}`,
    SK: 'METADATA',
    entityType: 'Team',
    teamId: team2Id,
    name: 'E2E テストチーム B',
    createdBy: ADMIN_USER_ID,
    createdAt: isoDate(80),
    updatedAt: isoDate(80),
  });

  // Team memberships (3 users in team 1)
  const memberUserIds = [
    `${PREFIX}reviewer-001`,
    `${PREFIX}reviewer-002`,
    `${PREFIX}reviewer-003`,
  ];

  for (const userId of memberUserIds) {
    items.push({
      PK: `TEAM#${TEAM_ID}`,
      SK: `MEMBER#${userId}`,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `TEAM#${TEAM_ID}`,
      entityType: 'TeamMembership',
      teamId: TEAM_ID,
      userId,
      createdAt: isoDate(85),
    });
  }

  // Team assignment (first 3 sessions assigned to team 1)
  for (let i = 1; i <= 3; i++) {
    const sessionId = `${PREFIX}session-${String(i).padStart(3, '0')}`;
    items.push({
      PK: `TEAM#${TEAM_ID}`,
      SK: `ASSIGNMENT#${sessionId}`,
      GSI1PK: `SESSION#${sessionId}`,
      GSI1SK: `TEAM#${TEAM_ID}`,
      entityType: 'TeamAssignment',
      teamId: TEAM_ID,
      sessionId,
      createdBy: ADMIN_USER_ID,
      createdAt: isoDate(60),
    });
  }

  return items;
}

// ============================================================
// 5. ContributorScore / Ranking (35 records)
// ============================================================

function generateRankingData(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const now = isoDate(0);

  for (let i = 1; i <= 35; i++) {
    const userId = `${PREFIX}ranker-${String(i).padStart(3, '0')}`;
    const displayName = `ランキングユーザー ${i}`;
    const answerCount = Math.max(1, 100 - i * 2);
    const accuracyRate = Math.max(0.3, 1.0 - i * 0.015);
    const score = parseFloat((answerCount * accuracyRate).toFixed(1));

    items.push({
      PK: 'RANKING#ALL',
      SK: `SCORE#${invertScore(score)}#${userId}`,
      GSI1PK: `USER#${userId}`,
      GSI1SK: 'RANKING#ALL',
      entityType: 'ContributorScore',
      userId,
      displayName,
      period: 'ALL',
      answerCount,
      accuracyRate: parseFloat(accuracyRate.toFixed(3)),
      score,
      createdAt: now,
      updatedAt: now,
    });
  }

  return items;
}

// ============================================================
// 6. IP Allowlist entries (4 records)
// ============================================================

function generateIPAllowlist(): Record<string, unknown>[] {
  const entries = [
    { cidr: '10.0.0.0/8', description: 'E2E プライベートネットワーク' },
    { cidr: '172.16.0.0/12', description: 'E2E 開発環境' },
    { cidr: '192.168.0.0/16', description: 'E2E ローカルネットワーク' },
    { cidr: '203.0.113.0/24', description: 'E2E テスト用 CIDR' },
  ];

  return entries.map((entry, i) => {
    const entryId = `${PREFIX}ip-${String(i + 1).padStart(3, '0')}`;
    return {
      PK: 'IPALLOWLIST',
      SK: `ENTRY#${entryId}`,
      entityType: 'IPAllowlistEntry',
      entryId,
      cidr: entry.cidr,
      description: entry.description,
      createdAt: isoDate(30 - i),
      createdBy: ADMIN_USER_ID,
    };
  });
}

// ============================================================
// 7. Audit Logs (60 records across 2 months)
// ============================================================

function generateAuditLogs(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const operationTypes = [
    'USER_MANAGEMENT',
    'TEAM_MANAGEMENT',
    'IP_ALLOWLIST_CHANGE',
    'REVIEW_ASSIGNMENT_CHANGE',
    'SESSION_COMPLETED',
  ] as const;

  for (let i = 0; i < 60; i++) {
    const logId = `${PREFIX}log-${String(i + 1).padStart(3, '0')}`;
    const daysAgo = i; // 0 to 59 days ago
    const createdAt = isoDate(daysAgo);
    const yearMonth = createdAt.slice(0, 7); // YYYY-MM
    const operationType = operationTypes[i % operationTypes.length];

    items.push({
      PK: `AUDIT#${yearMonth}`,
      SK: `LOG#${createdAt}#${logId}`,
      GSI1PK: `ACTOR#${ADMIN_USER_ID}`,
      GSI1SK: `LOG#${createdAt}`,
      GSI2PK: `OPERATION#${operationType}`,
      GSI2SK: `LOG#${createdAt}`,
      entityType: 'AuditLog',
      logId,
      createdAt,
      actorUserId: ADMIN_USER_ID,
      actorRole: 'ADMIN',
      operationType,
      resourceId: `${PREFIX}resource-${i}`,
      resourceType: 'TestResource',
      metadata: {
        reason: `E2E テスト用監査ログ #${i + 1}`,
      },
    });
  }

  return items;
}

// ============================================================
// Main: Execute seed
// ============================================================

async function main() {
  console.log('🌱 E2E シードデータ投入開始');
  console.log(`  Table: ${TABLE_NAME}`);
  console.log(`  Region: ${REGION}`);
  console.log('');

  try {
    // Sessions
    const sessions = generateSessions();
    console.log(`  [1/7] ReviewSession: ${sessions.length} 件...`);
    await batchPut(sessions);
    console.log('        ✓ 完了');

    // Segments
    const segments = generateSegments();
    console.log(`  [2/7] Segment: ${segments.length} 件...`);
    await batchPut(segments);
    console.log('        ✓ 完了');

    // Corrections
    const corrections = generateCorrections();
    console.log(`  [3/7] Correction: ${corrections.length} 件...`);
    await batchPut(corrections);
    console.log('        ✓ 完了');

    // Teams
    const teams = generateTeamData();
    console.log(`  [4/7] Team/Membership/Assignment: ${teams.length} 件...`);
    await batchPut(teams);
    console.log('        ✓ 完了');

    // Ranking
    const rankings = generateRankingData();
    console.log(`  [5/7] ContributorScore: ${rankings.length} 件...`);
    await batchPut(rankings);
    console.log('        ✓ 完了');

    // IP Allowlist
    const ipEntries = generateIPAllowlist();
    console.log(`  [6/7] IPAllowlistEntry: ${ipEntries.length} 件...`);
    await batchPut(ipEntries);
    console.log('        ✓ 完了');

    // Audit Logs
    const auditLogs = generateAuditLogs();
    console.log(`  [7/7] AuditLog: ${auditLogs.length} 件...`);
    await batchPut(auditLogs);
    console.log('        ✓ 完了');

    const total =
      sessions.length +
      segments.length +
      corrections.length +
      teams.length +
      rankings.length +
      ipEntries.length +
      auditLogs.length;

    console.log('');
    console.log(`🌱 シードデータ投入完了 (合計 ${total} 件)`);
  } catch (error) {
    console.error('');
    console.error('❌ シードデータ投入失敗:', error);
    process.exit(1);
  }
}

main();
